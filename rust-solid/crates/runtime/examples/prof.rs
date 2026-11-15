// Scratch profiling driver: one workload, fixed count, for callgrind.
#[path = "bench.rs"]
#[allow(dead_code)]
mod bench;
use rust_solid::plan_v2::App;
use bench::mount;
fn main() {
    let w = std::env::args().nth(1).unwrap();
    let n: usize = std::env::args().nth(2).unwrap().parse().unwrap();
    if w == "mount" {
        let p = bench::select();
        for _ in 0..n { let mut a = mount(p.clone()).unwrap(); a.turn(); a.dispose(); }
        return;
    }
    let p = match w.as_str() { "fanout" => bench::fanout(), "select" => bench::select(), "filter" => bench::filter(), _ => bench::counter() };
    let mut app = mount(p).unwrap();
    app.turn();
    let b = app.clickables()[0].0;
    for _ in 0..n { app.click(b).unwrap(); app.turn(); }
}
