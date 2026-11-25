/**
 * @file ReactiveScript (.rx) grammar for tree-sitter
 * @license MIT
 *
 * TSX's grammar (tree-sitter-typescript), with the forms .rx adds (spec/07-surface.md). The parser this follows is
 * compiler/src/parse.rs. Expressions, types and JSX keep TSX's node names, so TSX queries apply to them.
 *
 * A file is imports, declarations and markup. A reactive block (a component's body, an `if`/`for`/`loading`/
 * `errored`/`portal` body) is a `view_block`: declarations, then markup. Imperative code (handlers, `action` and
 * `effect` bodies) is TSX's `statement_block`, with writes (`x := e`), `guess`, `refresh`, `affects` and an inline
 * `action { … }` added to its statements.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const tsx = require('tree-sitter-typescript/tsx/grammar');

module.exports = grammar(tsx, {
  name: 'rx',

  // appended after TSX's externals: src/scanner.c's TokenType lists them in this order
  externals: ($, previous) => previous.concat([
    $._style_text,
  ]),

  precedences: ($, previous) => previous.concat([
    ['ternary', 'catch', $.arrow_function],
    ['unary_void', 'catch'],
  ]),

  conflicts: ($, previous) => previous.concat([
    // as TSX does for `await`: `<` after a prefix form's operand is a comparison or type arguments
    ...['throw_expression', 'pending_expression', 'latest_expression', 'peek_expression', 'pre_expression']
      .map((name) => [$.call_expression, $.instantiation_expression, $.binary_expression, $[name]]),
    [$.object, $._property_name],
    [$.primary_expression, $._equation_object_pattern],
    [$.side, $.server_fn_expression],
    [$.primary_expression, $.draft_expression],
    [$.primary_expression, $._property_name, $.draft_expression],
    [$.arrow_function, $._error_class],
  ]),

  rules: {
    // ---------------------------------------------------------------- modules

    program: $ => seq(
      optional($.hash_bang_line),
      repeat($._module_item),
    ),

    _module_item: $ => choice(
      $.import_statement,
      $.export_statement,
      $._view_item,
    ),

    // `import pure { a } from "./x"`, `import server { … }`, `… fails A | B`. `server`/`client` is a side before
    // `pure` or `{` (parse.rs's IMPORT_SIDE); in `import server from "./x"` it is the default import's name
    import_statement: $ => seq(
      'import',
      optional(field('side', $.side)),
      optional($.pure),
      choice(
        seq($.import_clause, $._from_clause),
        field('source', $.string),
      ),
      optional($.fails_clause),
      $._semicolon,
    ),

    _import_identifier: ($, previous) => choice(
      previous,
      alias(choice('server', 'client'), $.identifier),
    ),

    side: _ => choice('server', 'client'),
    pure: _ => 'pure',

    fails_clause: $ => seq('fails', $._error_classes),
    _error_classes: $ => seq($._error_class, repeat(seq('|', $._error_class))),
    _error_class: $ => alias($.identifier, $.type_identifier),

    export_statement: $ => seq(
      'export',
      optional('default'),
      field('declaration', $._declaration_item),
    ),

    // ---------------------------------------------------------------- declarations

    _declaration_item: $ => choice(
      $.source_declaration,
      $.equation,
      $.effect_declaration,
      $.fn_declaration,
      $.fn_signature,
      $.server_function_declaration,
      $.action_declaration,
      $.component_declaration,
      $.error_declaration,
      $.context_declaration,
      $.provide_declaration,
      $.type_alias_declaration,
      $.interface_declaration,
    ),

    _view_item: $ => choice(
      $._declaration_item,
      $._markup_item,
      $.empty_statement,
    ),

    _binding_name: $ => choice($.identifier, alias($._reserved_identifier, $.identifier)),

    // `source x: T key id := e` (a seed) or `source x = e` (a question)
    source_declaration: $ => seq(
      'source',
      field('name', $._binding_name),
      optional(field('type', $.type_annotation)),
      optional($.key_clause),
      field('operator', choice(':=', '=')),
      field('value', $.expression),
      $._semicolon,
    ),

    key_clause: $ => seq('key', field('name', $.identifier)),

    // `x = e`, `deferred x = e`, `rows key id = e`, `{ a, b } = props`
    equation: $ => seq(
      optional($.deferred),
      field('name', choice($._binding_name, alias($._equation_object_pattern, $.object_pattern), $.array_pattern)),
      optional(field('type', $.type_annotation)),
      optional($.key_clause),
      '=',
      field('value', $.expression),
      $._semicolon,
    ),

    deferred: _ => 'deferred',

    // TSX's object_pattern without its precedence, which prefers a block's `{ a }` as an expression: in a view,
    // `{ a, b } = props` (an equation per name, RG-4b) and `{a}` (markup) are told apart by the `=` that follows
    _equation_object_pattern: $ => seq(
      '{',
      commaSep(optional(choice(
        $.pair_pattern,
        $.rest_pattern,
        $.object_assignment_pattern,
        alias(choice($.identifier, $._reserved_identifier), $.shorthand_property_identifier_pattern),
      ))),
      '}',
    ),

    // `effect (a, b) { … }`
    effect_declaration: $ => seq(
      'effect',
      field('inputs', $.effect_inputs),
      field('body', $.statement_block),
    ),

    effect_inputs: $ => seq('(', optional(seq(commaSep1($.expression), optional(','))), ')'),

    // `fn f(a: T): R => e` or `fn f(ref a) { decls; tail }`
    fn_declaration: $ => seq(
      'fn',
      field('name', $._binding_name),
      field('parameters', $.formal_parameters),
      optional(field('return_type', $.type_annotation)),
      choice(
        seq('=>', field('body', $.expression), $._semicolon),
        field('body', $.fn_body),
      ),
    ),

    fn_body: $ => seq(
      '{',
      repeat(choice($._declaration_item, $.empty_statement)),
      field('value', $.expression),
      optional(';'),
      '}',
    ),

    // A declaration file's row: `server pure fn f(a: T): R rejects(E) instantiates`. As TSX's function_signature,
    // it does not end at a newline that a `{` follows: that is a fn's body (parse.rs skips newlines before it)
    fn_signature: $ => seq(
      optional(field('side', $.side)),
      optional($.pure),
      'fn',
      field('name', $._binding_name),
      field('parameters', $.formal_parameters),
      optional(field('return_type', $.type_annotation)),
      optional($.rejects_clause),
      optional('instantiates'),
      choice($._semicolon, $._function_signature_automatic_semicolon),
    ),

    rejects_clause: $ => seq('rejects', '(', $._error_classes, ')'),

    server_function_declaration: $ => seq(
      $.side,
      'fn',
      field('name', $._binding_name),
      field('parameters', $.formal_parameters),
      optional(field('return_type', $.type_annotation)),
      field('body', $.statement_block),
    ),

    action_declaration: $ => seq(
      'action',
      field('name', $._binding_name),
      field('parameters', $.formal_parameters),
      field('body', $.statement_block),
    ),

    component_declaration: $ => seq(
      'component',
      field('name', $.identifier),
      field('parameters', $.formal_parameters),
      field('body', $.view_block),
    ),

    // `error NotFound(id: number) => \`no user ${id}\``
    error_declaration: $ => seq(
      'error',
      field('name', alias($.identifier, $.type_identifier)),
      optional(field('parameters', $.formal_parameters)),
      optional(seq('=>', field('message', $.expression))),
      $._semicolon,
    ),

    // `context theme: Theme = dflt`
    context_declaration: $ => seq(
      'context',
      field('name', $._binding_name),
      optional(seq(':', optional('source'), field('type', $.type))),
      optional(seq('=', field('value', $.expression))),
      $._semicolon,
    ),

    provide_declaration: $ => seq(
      'provide',
      field('name', $._binding_name),
      '=',
      field('value', $.expression),
      $._semicolon,
    ),

    // ---------------------------------------------------------------- markup

    view_block: $ => seq('{', repeat($._view_item), '}'),

    _markup_item: $ => choice(
      $.jsx_element,
      $.jsx_self_closing_element,
      $.style_element,
      $.jsx_expression,
      $._control_block,
    ),

    _control_block: $ => choice(
      $.if_block,
      $.for_block,
      $.loading_block,
      $.errored_block,
      $.portal_block,
    ),

    if_block: $ => prec.right(seq(
      'if',
      field('condition', $.expression),
      field('consequence', $.view_block),
      optional(field('alternative', $.else_block)),
    )),

    else_block: $ => seq('else', choice($.view_block, $.if_block)),

    for_block: $ => seq(
      'for',
      field('name', $._binding_name),
      'in',
      field('value', $.expression),
      field('body', $.view_block),
    ),

    loading_block: $ => seq(
      'loading',
      optional(seq('on', '(', field('trigger', $.expression), ')')),
      'fallback',
      field('fallback', $.view_block),
      field('body', $.view_block),
    ),

    errored_block: $ => seq(
      'errored',
      'fallback',
      choice(
        seq($._arm_parameter, field('fallback', choice($.markup_error_arms, $.view_block))),
        seq(optional($._legacy_catch_parameter), field('fallback', $.view_block)),
      ),
      field('body', $.view_block),
    ),

    _arm_parameter: $ => seq('(', field('parameter', $._binding_name), ')'),
    _legacy_catch_parameter: $ => seq('(', field('parameter', $._binding_name), ':', field('type', $._error_classes), ')'),
    markup_error_arms: $ => seq('{', repeat1(seq($.markup_error_arm, optional(';'))), '}'),
    markup_error_arm: $ => seq($._arm_head, field('body', $.view_block)),
    _arm_head: $ => seq(field('class', choice('_', $._error_class)), '=>'),

    portal_block: $ => seq(
      'portal',
      optional(seq('to', '(', field('target', $.expression), ')')),
      field('body', $.view_block),
    ),

    // `{expr}`, and inside an element the braced control forms, `{if c { … }}`
    jsx_expression: $ => seq(
      '{',
      optional(choice(
        $.expression,
        $.sequence_expression,
        $.spread_element,
        $._control_block,
      )),
      '}',
    ),

    // `<style>` holds CSS, read as raw text up to `</style>` (CSS-1); as an expression it is a class map (CSS-5)
    style_element: $ => seq(
      '<',
      alias('style', $.identifier),
      '>',
      optional(alias($._style_text, $.raw_text)),
      '</',
      alias('style', $.identifier),
      '>',
    ),

    // parse.rs reads a `<style>` as raw CSS at any depth (the compiler then reports where it may not be)
    _jsx_child: ($, previous) => choice(previous, $.style_element),

    // `value=1`, `value=name`: parse.rs reads a primary expression after `=`
    _jsx_attribute_value: ($, previous) => choice(
      previous,
      $.identifier,
      $.number,
      $.template_string,
      $.true,
      $.false,
      $.null,
      $.undefined,
      $.parenthesized_expression,
      $.array,
    ),

    // ---------------------------------------------------------------- imperative statements

    statement: ($, previous) => choice(
      previous,
      $.write_statement,
      $.guess_statement,
      $.refresh_statement,
      $.affects_statement,
      $.action_statement,
    ),

    _write_target: $ => choice(
      $._binding_name,
      $.member_expression,
      $.subscript_expression,
      $.use_expression,
    ),

    // `x := e`, `xs[i].done := v`, `x := old => …`
    write_statement: $ => seq(
      field('target', $._write_target),
      ':=',
      field('value', $.expression),
      $._semicolon,
    ),

    guess_statement: $ => seq(
      'guess',
      field('target', $._write_target),
      ':=',
      field('value', $.expression),
      $._semicolon,
    ),

    refresh_statement: $ => seq('refresh', field('name', $.identifier), $._semicolon),

    affects_statement: $ => seq('affects', field('name', $.identifier), $._semicolon),

    // `action { … }`: an inline action, one run
    action_statement: $ => seq('action', field('body', $.statement_block)),

    // ---------------------------------------------------------------- expressions

    // 07 §3: no assignment operators (`=`, `+=`): a statement-level `x = e` is an equation, a write is `x := e`
    expression: ($, previous) => choice(
      ...previous.members.filter((member) =>
        member.name !== 'assignment_expression' && member.name !== 'augmented_assignment_expression'),
      $.pending_expression,
      $.latest_expression,
      $.peek_expression,
      $.pre_expression,
      $.use_expression,
      $.throw_expression,
      $.catch_expression,
      $.draft_expression,
      $.fn_expression,
      $.server_fn_expression,
      $.style_element,
    ),

    // `await e`, `await e -> first`, `await* stream -> first`
    await_expression: $ => prec.right('unary_void', seq(
      'await',
      optional(field('stream', '*')),
      field('argument', $.expression),
      optional(seq('->', field('initial', $.expression))),
    )),

    pending_expression: $ => prec.left('unary_void', seq('pending?', field('argument', $.expression))),

    latest_expression: $ => prec.left('unary_void', seq('latest', field('argument', $.expression))),

    peek_expression: $ => prec.left('unary_void', seq('peek', field('argument', $.expression))),

    // `pre x`, `pre x -> init`
    pre_expression: $ => prec.right('unary_void', seq(
      'pre',
      field('name', $.identifier),
      optional(seq('->', field('initial', $.expression))),
    )),

    use_expression: $ => prec('unary_void', seq('use', field('name', $.identifier))),

    // TC39's throw expression: `c ? a : throw NotFound(id)`
    throw_expression: $ => prec.left('unary_void', seq('throw', field('argument', $.expression))),

    // Looser than every operator; a chain folds left, `(a catch => b) catch => c`.
    catch_expression: $ => prec.left('catch', seq(
      field('value', $.expression),
      'catch',
      choice(
        seq($._arm_parameter, choice(field('arms', $.expression_error_arms), seq('=>', field('alternative', $.expression)))),
        seq(optional($._legacy_catch_parameter), '=>', field('alternative', $.expression)),
      ),
    )),

    catch_clause: $ => seq(
      'catch',
      choice(
        seq($._arm_parameter, field('body', choice($.statement_error_arms, $.statement_block))),
        seq(optional(seq('(', field('parameter', $._binding_name), field('type', $.type_annotation), ')')), field('body', $.statement_block)),
      ),
    ),
    statement_error_arms: $ => prec.dynamic(1, seq('{', repeat1(seq($.statement_error_arm, optional(';'))), '}')),
    statement_error_arm: $ => seq($._arm_head, field('body', $.statement_block)),
    expression_error_arms: $ => seq('{', repeat1(seq($.expression_error_arm, optional(';'))), '}'),
    expression_error_arm: $ => seq($._arm_head, '{', field('body', $.expression), '}'),

    // `draft(e) { d[id] := true }`
    draft_expression: $ => seq(
      'draft',
      '(',
      field('value', $.expression),
      ')',
      field('body', $.statement_block),
    ),

    // `fn (a, b) => e`
    fn_expression: $ => prec.right(seq(
      'fn',
      field('parameters', $.formal_parameters),
      '=>',
      field('body', $.expression),
    )),

    // `server fn (a: T): R { … }`
    server_fn_expression: $ => seq(
      'server',
      'fn',
      field('parameters', $.formal_parameters),
      optional(field('return_type', $.type_annotation)),
      field('body', $.statement_block),
    ),

    // `fn area(ref w: number)`: an instantiation parameter (E-9)
    _parameter_name: ($, previous) => seq(
      optional($.ref_modifier),
      previous,
    ),

    ref_modifier: _ => 'ref',

    // `): ref string`, `): [ref boolean, (v: boolean) => void]`: an accessor in a signature's return (MO-10b)
    type: ($, previous) => choice(previous, $.ref_type),

    ref_type: $ => prec.right(seq($.ref_modifier, $.type)),

    _reserved_identifier: ($, previous) => choice(
      previous,
      'server',
      'client',
      'error',
      'draft',
    ),
  },
});

/**
 * @param {RuleOrLiteral} rule
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}

/**
 * @param {RuleOrLiteral} rule
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
