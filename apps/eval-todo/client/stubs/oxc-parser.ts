// The browser build has no Oxc (a native module): RX code compiles in the page, TSX code arrives compiled by the server.
export const parseSync = () => { throw new Error('TSX syntax is compiled on the server in this demo (Oxc is native)'); };
export const Visitor = class {};
