import "@fontsource/kalam/latin-300.css";
import "@fontsource/kalam/latin-400.css";
import "@fontsource/kalam/latin-700.css";
import "@fontsource/patrick-hand/latin-400.css";
import "@fontsource/courier-prime/latin-400.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@xterm/xterm/css/xterm.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

// xterm measures glyphs once at open(); make sure the mono font is there first.
Promise.race([
  Promise.all([
    document.fonts.load('13px "JetBrains Mono"'),
    document.fonts.load('700 13px "JetBrains Mono"'),
    document.fonts.load('16px "Kalam"'),
  ]),
  new Promise((r) => setTimeout(r, 800)),
]).finally(() => {
  mount(App, { target: document.getElementById("app")! });
});
