// Fidelity measuring tool (no deps; CoreGraphics only).
//   measure stats <image.png> <x,y,w,h> ...   → JSON stats per region on a 2000×1250 canvas
//   measure sbs <a.png> <b.png> <out.png>     → side-by-side, both scaled to 2000×1250
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
