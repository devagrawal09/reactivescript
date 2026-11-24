import { createApp } from "/home/lucifer/work/solidjs/rx-store-proto-base/ref/compile/rt-web.ts";
import main from "./main.mjs";
import * as api from "./api.mjs";
const app = createApp({ root: document.getElementById("app"), api });
app.mount(main(app));
