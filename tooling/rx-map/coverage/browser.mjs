import { attach } from "../live.mjs";
import { createCollector } from "../coverage.mjs";

if (!globalThis.__RX_COVERAGE__) {
  const { feed, begin, end, result, trace } = createCollector({
    graphs: () => globalThis.__RX__?.graphs ?? [], tool: "browser",
  });
  const bridge = attach(feed);
  globalThis.__RX_COVERAGE__ = {
    begin(name) { begin(name); bridge.post({ type: "snapshot?" }); },
    end, result, trace,
  };
  bridge.post({ type: "snapshot?" });
}
