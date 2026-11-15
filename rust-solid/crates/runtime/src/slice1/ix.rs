//! A node's links to other nodes, links, boundaries and families are
//! `Option<usize>` in the logic, 16 bytes each. A node has a dozen, so they
//! are stored as `Ix`, a u32 with `u32::MAX` for none.

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Ix(u32);

impl Ix {
    pub const NONE: Ix = Ix(u32::MAX);

    #[inline]
    pub fn get(self) -> Option<usize> {
        (self.0 != u32::MAX).then_some(self.0 as usize)
    }
    #[inline]
    pub fn is_some(self) -> bool {
        self.0 != u32::MAX
    }
    #[inline]
    pub fn is_none(self) -> bool {
        self.0 == u32::MAX
    }
    #[inline]
    pub fn take(&mut self) -> Option<usize> {
        std::mem::replace(self, Ix::NONE).get()
    }
}

impl From<Option<usize>> for Ix {
    #[inline]
    fn from(v: Option<usize>) -> Ix {
        match v {
            Some(i) => {
                debug_assert!(i < u32::MAX as usize);
                Ix(i as u32)
            }
            None => Ix::NONE,
        }
    }
}

impl PartialEq<Option<usize>> for Ix {
    #[inline]
    fn eq(&self, o: &Option<usize>) -> bool {
        self.get() == *o
    }
}

impl PartialEq<Ix> for Option<usize> {
    #[inline]
    fn eq(&self, o: &Ix) -> bool {
        *self == o.get()
    }
}
