// The page's entry: what the page was before anything ran (a pop-out is written from it), then the program, mounted.
import { capturePristine } from "./js/env.js";
capturePristine();
import { createApp } from "@reactivescript/runtime";
import main from "./main.rx";

const app = createApp({ root: document.getElementById("app") });
app.mount(main(app));
