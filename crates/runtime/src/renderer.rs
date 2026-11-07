//! Host operations used by the plan evaluator. No runtime state lives here.
use std::collections::BTreeMap;
pub type Node = usize;
pub trait Renderer {
    fn create_element(&mut self, tag: &str) -> Node;
    fn create_text(&mut self, text: &str) -> Node;
    fn replace_text(&mut self, node: Node, text: &str);
    fn set_prop(&mut self, node: Node, name: &str, value: &str);
    fn insert(&mut self, parent: Node, node: Node, anchor: Option<Node>);
    fn remove(&mut self, parent: Node, node: Node);
    fn parent(&self, node: Node) -> Option<Node>;
    fn next_sibling(&self, node: Node) -> Option<Node>;
    fn event(&mut self, node: Node, name: &str, handler: &str);
}
#[derive(Default)]
struct Item {
    tag: Option<String>,
    text: String,
    props: BTreeMap<String, String>,
    events: BTreeMap<String, String>,
    children: Vec<Node>,
    parent: Option<Node>,
}
#[derive(Default)]
pub struct TextRenderer {
    items: Vec<Item>,
}
impl TextRenderer {
    pub fn handler(&self, node: Node, name: &str) -> Option<String> {
        self.items[node].events.get(name).cloned()
    }
    pub fn clickable(&self, root: Node) -> Vec<Node> {
        let mut out = Vec::new();
        if self.items[root].events.contains_key("onClick") {
            out.push(root)
        }
        for n in &self.items[root].children {
            out.extend(self.clickable(*n))
        }
        out
    }
    pub fn find(&self, root: Node, tag: &str) -> Option<Node> {
        if self.items[root].tag.as_deref() == Some(tag) {
            return Some(root);
        }
        self.items[root]
            .children
            .iter()
            .find_map(|n| self.find(*n, tag))
    }
    pub fn frame(&self, root: Node) -> String {
        let n = &self.items[root];
        if n.tag.is_none() {
            return n.text.clone();
        }
        n.children.iter().map(|n| self.frame(*n)).collect()
    }
}
impl Renderer for TextRenderer {
    fn create_element(&mut self, tag: &str) -> Node {
        let id = self.items.len();
        self.items.push(Item {
            tag: Some(tag.into()),
            ..Item::default()
        });
        id
    }
    fn create_text(&mut self, text: &str) -> Node {
        let id = self.items.len();
        self.items.push(Item {
            text: text.into(),
            ..Item::default()
        });
        id
    }
    fn replace_text(&mut self, node: Node, text: &str) {
        assert!(self.items[node].tag.is_none());
        self.items[node].text = text.into();
    }
    fn set_prop(&mut self, node: Node, name: &str, value: &str) {
        self.items[node].props.insert(name.into(), value.into());
    }
    fn insert(&mut self, parent: Node, node: Node, anchor: Option<Node>) {
        if anchor == Some(node) {
            return;
        }
        if let Some(old) = self.parent(node) {
            self.remove(old, node);
        }
        let at = anchor
            .map(|a| {
                self.items[parent]
                    .children
                    .iter()
                    .position(|n| *n == a)
                    .expect("anchor is not a child")
            })
            .unwrap_or(self.items[parent].children.len());
        self.items[parent].children.insert(at, node);
        self.items[node].parent = Some(parent);
    }
    fn remove(&mut self, parent: Node, node: Node) {
        let at = self.items[parent]
            .children
            .iter()
            .position(|n| *n == node)
            .expect("not a child");
        self.items[parent].children.remove(at);
        self.items[node].parent = None;
    }
    fn parent(&self, node: Node) -> Option<Node> {
        self.items[node].parent
    }
    fn next_sibling(&self, node: Node) -> Option<Node> {
        let p = self.parent(node)?;
        let ns = &self.items[p].children;
        ns.get(ns.iter().position(|n| *n == node)? + 1).copied()
    }
    fn event(&mut self, node: Node, name: &str, handler: &str) {
        self.items[node].events.insert(name.into(), handler.into());
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_are_exact_text_not_html() {
        let mut r = TextRenderer::default();
        let root = r.create_element("#root");
        let b = r.create_element("button");
        let text = r.create_text(" <&>\n");
        r.set_prop(b, "title", "not rendered");
        r.event(b, "onClick", "h");
        r.insert(root, b, None);
        r.insert(b, text, None);
        assert_eq!(r.frame(root), " <&>\n");
        assert_eq!(r.clickable(root), vec![b]);
    }
    #[test]
    fn moves_and_anchors() {
        let mut r = TextRenderer::default();
        let root = r.create_element("#root");
        let a = r.create_text("a");
        let b = r.create_text("b");
        r.insert(root, a, None);
        r.insert(root, b, Some(a));
        assert_eq!(r.frame(root), "ba");
        assert_eq!(r.next_sibling(b), Some(a));
        r.insert(root, b, None);
        assert_eq!(r.frame(root), "ab");
        r.remove(root, a);
        assert_eq!(r.parent(a), None);
        assert_eq!(r.frame(root), "b");
    }
}
