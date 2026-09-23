// Fidelity measuring tool (no deps; CoreGraphics only).
//   measure stats <image.png> <x,y,w,h> ...   → JSON stats per region on a 2000×1250 canvas
//   measure sbs <a.png> <b.png> <out.png>     → side-by-side, both scaled to 2000×1250
//   measure crop <in.png> x,y,w,h <out.png> [mirror | alpha=R,G,B]
//        crop on the 2000×1250 canvas; mirror = seamless 2×2 tile; alpha = lift ink off a paper
//        color (GIMP-style color-to-alpha) so the stroke composites on any surface
//   measure rows <in.png> x,y,w,h            → mean luminance per row (find ruled lines)
//   measure window <pid>                      → CGWindowID of that process's main window
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let W = 2000, H = 1250

func load(_ path: String) -> CGImage {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fatalError("can't read \(path)") }
  return img
}

/// Draw into an sRGB RGBA8 buffer at canvas size.
func pixels(_ img: CGImage, _ w: Int = W, _ h: Int = H) -> [UInt8] {
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  return buf
}

func stats(_ px: [UInt8], _ r: [Int]) -> [String: Double] {
  let (x0, y0, w, h) = (r[0], r[1], r[2], r[3])
  var sum = [0.0, 0.0, 0.0], lum = [Double]()
  lum.reserveCapacity(w * h)
  for y in y0..<(y0 + h) {
    for x in x0..<(x0 + w) {
      let i = (y * W + x) * 4 // CG buffer origin is top-left for bitmap contexts drawn this way
      let (R, G, B) = (Double(px[i]), Double(px[i + 1]), Double(px[i + 2]))
      sum[0] += R; sum[1] += G; sum[2] += B
      lum.append(0.2126 * R + 0.7152 * G + 0.0722 * B)
    }
  }
  let n = Double(w * h)
  let mean = lum.reduce(0, +) / n
  let fine = sqrt(lum.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / n)
  // low-frequency variation: σ of 8×8 block means
  var blocks = [Double]()
  for by in stride(from: 0, to: h - 7, by: 8) {
    for bx in stride(from: 0, to: w - 7, by: 8) {
      var s = 0.0
      for yy in 0..<8 { for xx in 0..<8 { s += lum[(by + yy) * w + bx + xx] } }
      blocks.append(s / 64)
    }
  }
  let bm = blocks.reduce(0, +) / Double(max(blocks.count, 1))
  let low = sqrt(blocks.map { ($0 - bm) * ($0 - bm) }.reduce(0, +) / Double(max(blocks.count, 1)))
  return ["r": sum[0] / n, "g": sum[1] / n, "b": sum[2] / n, "fine": fine, "low": low]
}

func save(_ img: CGImage, _ path: String) {
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "stats":
  let px = pixels(load(args[2]))
  var out = [[String: Double]]()
  for spec in args.dropFirst(3) { out.append(stats(px, spec.split(separator: ",").map { Int($0)! })) }
  print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
case "sbs":
  let a = load(args[2]), b = load(args[3])
  let ctx = CGContext(data: nil, width: W * 2 + 20, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 0, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: W * 2 + 20, height: H))
  ctx.interpolationQuality = .high
  ctx.draw(a, in: CGRect(x: 0, y: 0, width: W, height: H))
  ctx.draw(b, in: CGRect(x: W + 20, y: 0, width: W, height: H))
  save(ctx.makeImage()!, args[4])
case "crop", "rows":
  let img = load(args[2])
  let sx = Double(img.width) / Double(W), sy = Double(img.height) / Double(H)
  let r = args[3].split(separator: ",").map { Double($0)! }
  let rect = CGRect(x: r[0] * sx, y: r[1] * sy, width: r[2] * sx, height: r[3] * sy).integral
  var part = img.cropping(to: rect)!
  if args[1] == "rows" {
    let w = part.width, h = part.height
    let px = pixels(part, w, h)
    for y in 0..<h {
      var s = 0.0
      for x in 0..<w { let i = (y * w + x) * 4; s += 0.2126 * Double(px[i]) + 0.7152 * Double(px[i+1]) + 0.0722 * Double(px[i+2]) }
      print(y, String(format: "%.1f", s / Double(w)))
    }
    break
  }
  var outImg = part
  // contrast=K: stretch around the mean, compensating the blur of upscaling a 1× sample on 2× screens
  if let spec = args.dropFirst(5).first(where: { $0.hasPrefix("contrast=") }) {
    let k = Double(spec.dropFirst(9))!
    let w = part.width, h = part.height
    var px = pixels(part, w, h)
    var mean = [0.0, 0.0, 0.0]
    for i in stride(from: 0, to: px.count, by: 4) { for c in 0..<3 { mean[c] += Double(px[i + c]) } }
    for c in 0..<3 { mean[c] /= Double(w * h) }
    for i in stride(from: 0, to: px.count, by: 4) {
      for c in 0..<3 { px[i + c] = UInt8(max(0, min(255, (mean[c] + (Double(px[i + c]) - mean[c]) * k).rounded()))) }
    }
    let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    outImg = ctx.makeImage()!
  }
  part = outImg
  if args.count > 5 && args[5].hasPrefix("alpha=") {
    let bg = args[5].dropFirst(6).split(separator: ",").map { Double($0)! / 255 }
    let w = part.width, h = part.height
    var px = pixels(part, w, h)
    for i in stride(from: 0, to: px.count, by: 4) {
      var a = 0.0
      for c in 0..<3 {
        let p = Double(px[i + c]) / 255, b = bg[c]
        let ac = p > b ? (p - b) / (1 - b) : (b - p) / b
        a = max(a, ac)
      }
      a = min(1, a * 1.08)
      if a < 0.035 { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0; continue }
      for c in 0..<3 {
        let p = Double(px[i + c]) / 255, b = bg[c]
        let col = min(1, max(0, (p - b) / a + b))
        px[i + c] = UInt8((col * a * 255).rounded()) // premultiplied
      }
      px[i + 3] = UInt8((a * 255).rounded())
    }
    // fill=N: wipe the middle (text) by extending column N across each row → a clean 9-slice
    if args.count > 6 && args[6].hasPrefix("fill=") {
      let n = Int(args[6].dropFirst(5))!
      for y in n..<(h - n) {
        let src = (y * w + n) * 4
        for x in n..<(w - n) { for c in 0..<4 { px[(y * w + x) * 4 + c] = px[src + c] } }
      }
    }
    let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    outImg = ctx.makeImage()!
  }
  if args.count > 5 && args[5].hasPrefix("hole=") {
    // keep only an N-px frame (for 9-slice edges): clear the middle to transparent
    let n = Int(args[5].dropFirst(5))!
    let w = part.width, h = part.height
    var px = pixels(part, w, h)
    for y in n..<(h - n) { for x in n..<(w - n) { for c in 0..<4 { px[(y * w + x) * 4 + c] = 0 } } }
    let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    outImg = ctx.makeImage()!
  }
  if args.count > 5 && args[5] == "mirror" {
    let part = outImg
    let w = part.width, h = part.height
    let ctx = CGContext(data: nil, width: w * 2, height: h * 2, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    for (fx, fy, ox, oy) in [(1.0, 1.0, 0, 0), (-1.0, 1.0, 2 * w, 0), (1.0, -1.0, 0, 2 * h), (-1.0, -1.0, 2 * w, 2 * h)] {
      ctx.saveGState()
      ctx.translateBy(x: CGFloat(ox), y: CGFloat(oy))
      ctx.scaleBy(x: CGFloat(fx), y: CGFloat(fy))
      ctx.draw(part, in: CGRect(x: 0, y: 0, width: w, height: h))
      ctx.restoreGState()
    }
    outImg = ctx.makeImage()!
  }
  save(outImg, args[4])
case "window":
  let pid = Int(args[2])!
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
  for w in list where (w[kCGWindowOwnerPID as String] as? Int) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    if ((b["Height"] as? Double) ?? 0) > 300 { print(w[kCGWindowNumber as String]!); exit(0) }
  }
  exit(1)
default:
  print("usage: measure stats|sbs|window …"); exit(2)
}
