import { createMemo } from "solid-js";
export function App(props) {
  const user = createMemo(() => props.ask("u"));
  return <Errored fallback={e => <p>failed: {e().message}</p>}>
    <Loading fallback={<p>loading</p>}><p>{user()}</p></Loading>
  </Errored>;
}
