;; ReactiveScript (.rx). Patterns are ordered general first, specific last (a later pattern wins, as in Zed and
;; Neovim). The TSX part is tree-sitter-javascript's highlights.scm, highlights-jsx.scm and
;; tree-sitter-typescript's highlights.scm, without what .rx has no node for (assignment); the .rx part is at the end.

;; ---- tree-sitter-javascript: highlights.scm

; Variables
;----------

(identifier) @variable

; Properties
;-----------

(property_identifier) @property

; Function and method definitions
;--------------------------------

(function_expression
  name: (identifier) @function)
(function_declaration
  name: (identifier) @function)
(method_definition
  name: (property_identifier) @function.method)

(pair
  key: (property_identifier) @function.method
  value: [(function_expression) (arrow_function)])

(variable_declarator
  name: (identifier) @function
  value: [(function_expression) (arrow_function)])

; Function and method calls
;--------------------------

(call_expression
  function: (identifier) @function)

(call_expression
  function: (member_expression
    property: (property_identifier) @function.method))

; Special identifiers
;--------------------

((identifier) @constructor
 (#match? @constructor "^[A-Z]"))

([
    (identifier)
    (shorthand_property_identifier)
    (shorthand_property_identifier_pattern)
 ] @constant
 (#match? @constant "^[A-Z_][A-Z\\d_]+$"))

((identifier) @variable.builtin
 (#match? @variable.builtin "^(arguments|module|console|window|document)$")
 (#is-not? local))

((identifier) @function.builtin
 (#eq? @function.builtin "require")
 (#is-not? local))

; Literals
;---------

(this) @variable.builtin
(super) @variable.builtin

[
  (true)
  (false)
  (null)
  (undefined)
] @constant.builtin

(comment) @comment

[
  (string)
  (template_string)
] @string

(regex) @string.special
(number) @number

; Tokens
;-------

[
  ";"
  (optional_chain)
  "."
  ","
] @punctuation.delimiter

[
  "-"
  "--"
  "+"
  "++"
  "*"
  "**"
  "/"
  "%"
  "<"
  "<="
  "<<"
  "="
  "=="
  "==="
  "!"
  "!="
  "!=="
  "=>"
  ">"
  ">="
  ">>"
  ">>>"
  "~"
  "^"
  "&"
  "|"
  "&&"
  "||"
  "??"
] @operator

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
]  @punctuation.bracket

(template_substitution
  "${" @punctuation.special
  "}" @punctuation.special) @embedded

[
  "as"
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "debugger"
  "default"
  "delete"
  "do"
  "else"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "import"
  "in"
  "instanceof"
  "let"
  "new"
  "of"
  "return"
  "set"
  "static"
  "switch"
  "target"
  "throw"
  "try"
  "typeof"
  "var"
  "void"
  "while"
  "with"
  "yield"
] @keyword

;; ---- tree-sitter-javascript: highlights-jsx.scm

(jsx_opening_element (identifier) @tag (#match? @tag "^[a-z][^.]*$"))
(jsx_closing_element (identifier) @tag (#match? @tag "^[a-z][^.]*$"))
(jsx_self_closing_element (identifier) @tag (#match? @tag "^[a-z][^.]*$"))

(jsx_attribute (property_identifier) @attribute)
(jsx_opening_element (["<" ">"]) @punctuation.bracket)
(jsx_closing_element (["</" ">"]) @punctuation.bracket)
(jsx_self_closing_element (["<" "/>"]) @punctuation.bracket)

;; ---- tree-sitter-typescript: highlights.scm

; Types

(type_identifier) @type
(predefined_type) @type.builtin

; upstream's `((identifier) @type (#match? @type "^[A-Z]"))` is left out: it comes after @constructor and @constant, so
; with later patterns winning it would make every capitalised name (a constant, an error's constructor, a component's
; tag) a type

(type_arguments
  "<" @punctuation.bracket
  ">" @punctuation.bracket)

; Variables

(required_parameter (identifier) @variable.parameter)
(optional_parameter (identifier) @variable.parameter)

; Keywords

[ "abstract"
  "declare"
  "enum"
  "export"
  "implements"
  "interface"
  "keyof"
  "namespace"
  "private"
  "protected"
  "public"
  "type"
  "readonly"
  "override"
  "satisfies"
] @keyword

;; ---- ReactiveScript

; Keywords

[
  "source"
  "component"
  "action"
  "effect"
  "fn"
  "context"
  "provide"
  "use"
  "error"
  "server"
  "client"
  "key"
  "fails"
  "rejects"
  "instantiates"
  "guess"
  "refresh"
  "affects"
  "loading"
  "errored"
  "fallback"
  "on"
  "portal"
  "to"
  "latest"
  "peek"
  "pre"
  "pending?"
  "draft"
] @keyword

(side) @keyword
(pure) @keyword
(deferred) @keyword
(ref_modifier) @keyword

; `:=` writes and seeds, `->` a first value
[
  ":="
  "->"
] @operator

(await_expression
  "*" @keyword)

; Declarations: a source is state, an equation a derived value, a context a constant name

(source_declaration
  name: (identifier) @variable)

(equation
  name: (identifier) @constant)

(equation
  name: (object_pattern
    (shorthand_property_identifier_pattern) @constant))

(equation
  name: (object_pattern
    (pair_pattern
      value: (identifier) @constant)))

(equation
  name: (array_pattern
    (identifier) @constant))

(context_declaration
  name: (identifier) @constant)

(provide_declaration
  name: (identifier) @constant)

(use_expression
  name: (identifier) @constant)

(key_clause
  name: (identifier) @property)

(fn_declaration
  name: (identifier) @function)

(fn_signature
  name: (identifier) @function)

(server_function_declaration
  name: (identifier) @function)

(action_declaration
  name: (identifier) @function)

(component_declaration
  name: (identifier) @function)

(error_declaration
  name: (type_identifier) @type)

; Writes: the target of `:=` and `guess`

(write_statement
  target: (identifier) @variable)

(guess_statement
  target: (identifier) @variable)

(refresh_statement
  name: (identifier) @variable)

(affects_statement
  name: (identifier) @variable)

; Names bound by parameters, markup and catches

(required_parameter
  pattern: (object_pattern
    [
      (shorthand_property_identifier_pattern) @variable.parameter
      (object_assignment_pattern
        left: (shorthand_property_identifier_pattern) @variable.parameter)
      (pair_pattern
        value: (identifier) @variable.parameter)
    ]))

(for_block
  name: (identifier) @variable.parameter)

(errored_block
  parameter: (identifier) @variable.parameter)

(catch_expression
    parameter: (identifier) @variable.parameter)

(catch_clause
    parameter: (identifier) @variable.parameter)

[
  (statement_error_arm class: "_" @keyword)
  (expression_error_arm class: "_" @keyword)
  (markup_error_arm class: "_" @keyword)
]

(pre_expression
  name: (identifier) @variable)

; An effect's values, `$0` … `$n`

((identifier) @variable.builtin
  (#match? @variable.builtin "^\\$[0-9]+$"))

; The prelude's functions

(call_expression
  function: (identifier) @function.builtin
  (#any-of? @function.builtin "log" "onFlush" "onSettled"))

; <style>

(style_element
  (identifier) @tag)

(style_element
  [
    "<"
    ">"
    "</"
  ] @punctuation.bracket)
