/* kells.js - the kells language, v. 0.1
 *
 * MIT licensed; see the file LICENSE for the full details.
 */

// maintain compatibility with old-form browser includes and npm modules.
// TODO: make this work with ES6 modules once NPM figures out how they're gonna roll with that.
var kells = typeof exports !== 'undefined' ? exports : {};

kells.version = '0.1.0';

(function () { // scope bracket for the functions defined herein, just in case we're in a browser.
    "use strict";
    // Used to replaces position indices with (line, col) so we have some context in the case of errors.
    // the `string` is the source file, the `i` is the character index of the error.
    function linecol_from_pos(string, i) {
        var s = string.slice(0, i),
            last_line = /.*$/.exec(s)[0],
            newlines_before = s.slice(0, -last_line.length).replace(/[^\n]/g, '');

        return {line: newlines_before.length + 1, col: last_line.replace(/\t/g, '    ').length + 1};
    }
    // create an error of type `Con` (e.g. SyntaxError) with message `err_str` at poition `pos` in
    // the given `source` code.
    function pretty_error(Con, err_str, pos, source) {
        if (source === undefined) {
            return new Con(err_str, "interpreted");
        }
        // pretty print the (line, col) pair. Run using String.prototype.replace, hence the ignored
        // first argument; we're replacing 'position #1234' with 'line 3, column 24' in `err_str`.
        function linecol(_, pos) {
            var lc = linecol_from_pos(source, parseInt(pos));
            return "line " + lc.line + ", column " + lc.col;
        }
        var lc = linecol_from_pos(source, pos),
            ol = source.split('\n')[lc.line - 1].replace('\t', '    '),
            i;
        err_str = 'kells.' + Con.name + ': ' + err_str.replace(/position #(\d+)/g, linecol);
        // the above position # could refer to something other than the `pos` we've been given, e.g.
        // where a list begins. We also add to that the info of where the error was actually 
        // detected, which is `pos`:
        err_str += "\nAt: line " + lc.line + ", column " + lc.col;
        // then we try to print the line of code that lc.line is, with an arrow pointing to the col.
        // if it's before column 30 we print the whole line up to 60 chars, otherwise we print the 
        // line between 30 chars before the error and 30 chars after the error.
        if (lc.col < 30) {
            err_str += "\nContext: " + ol.slice(0, lc.col + 30) + (lc.col + 30 < ol.length? '[...]' : '');
            err_str += "\n    -----";
        } else {
            err_str += "\nContext: [...]" + ol.slice(lc.col - 30, lc.col + 30)) + (lc.col + 30 < ol.length ? '[...]' : '');
            err_str += "\n    ----------";
        for (i = Math.min(lc.col,  30); i > 1; i--) {
            err_str += "-";
        }
        err_str += "^\n";
        // then we can run the Con function that we got with the error string we just made.
        return new Con(err_str, "interpreted", lc.line);
    }
    /* regular expressions used by kells.parse() */
    var re_json_string = /^[^\u0000-\u001f\u007f-\u009f\\"]/,
        re_json_backslash_escapes = /^[\\"\/bfnrt]|^u\d{4}/,
        re_var_start = /^[a-z_]/,
        re_var_body = /^[a-zA-Z0-9_']/,
        re_whitespace = /^[\s\n]/,
        debug_mode = false;

    /* kells.parse :: Text -> ParseTree */
    kells.parse = function kells_parse(string) {
        var i = 0,        // current index into the string, mutated by parse functions
            parse = {},   // namespace for the different parse functions defined here
            final_output, // only used at the end of the expression to inspect for failure.
            tabs = '',    // used when debug_mode is set to indent parse expressions as they are nested.
            log = function (name, fn) {
                // transform a function into a function which logs, if debug_mode is set.
                // if it's not set, there is no overhead because we just return the function here:
                if (!debug_mode){ 
                    return fn;
                }
                return function () {
                    console.log(`${tabs}${name} at=${i} charAt='${string[i]}'`);
                    tabs += '  ';
                    var out = fn();
                    tabs = tabs.slice(2);
                    console.log(`${tabs}/${name} out=${JSON.stringify(out)} at=${i} charAt='${string[i]}'`);
                    return out;
                };
            };
        // parse.token is a general central point to return when you expect another token, e.g.
        // after a , in list syntax or after a string when you're processing function evaluations.
        // This can return a special expression of type token-fail which should NEVER be propagated
        // to the user; it is an internal status only. Consumers of a token-fail must either recover
        // from it (e.g. at the end of a line of function evaluations) or emit their own fail-expr.
        // parse.token does NOT handle leading/trailing whitespace, either; it expects to look at
        // string[i] and dispatch to the appropriate subroutine.
        parse.token = log('token', function () {
            if (i < string.length) {
                if (string[i] === '"') {
                    return parse.string();
                }
                if (string[i] === "[") {
                    return parse.list();
                }
                if (string[i] === "(") {
                    return parse.parens();
                }
                if (re_var_start.test(string[i])) {
                    return parse.identifier();
                }
            }
            return {type: 'token-fail', pos: i, value: 'Expected a variable, list, string, or parentheses.'};
        });
        // parse.list handles list syntax: start with a [ (which should already have been detected
        // by parse.token), skip past whitespace, continue parsing comma-separated expr's until you 
        // see a ].
        parse.list = log('list', function () {
            var context = i, out = [], tmp;
            i += 1; // skip past '['
            parse.whitespace();
            if (string[i] === "]") {
                i += 1;
                return {type: 'list', value: out, pos: context};
            }
            tmp = parse.expr();
            if (tmp.type === 'fail') {
                return tmp;
            }
            out.push(tmp);
            while (string[i] === ",") {
                  i += 1;
                  parse.whitespace();
                tmp = parse.expr();
                if (tmp.type === 'fail') {
                    return tmp;
                }
                out.push(tmp);
                parse.whitespace();
            }
            if (string[i] === "]") {
                i += 1;
                return {type: 'list', value: out, pos: context };
            }
            return {type: 'fail', pos: i, value: 'Expected the list starting at position #' + context +
                    ' to either continue with "," or end with "]".'};
        });
        // parse.string handles string syntax: start with a " and consume re_json_string-matching
        // characters until seeing either an escape-sequence or a close-quote ". Escapes are checked
        // for matching JSON syntax so that the error can be pretty-printed.
        parse.string = log('string', function () {
            var context = i, out = '"', tmp;
            i += 1; // skip past first '"'
            while (i < string.length) {
                if (re_json_string.test(string[i])) {
                    out += string[i++];
                } else if (string[i] === '"') {
                    out += string[i++];
                    return {type: 'string', value: JSON.parse(out), pos: context};
                } else if (string[i] === '\\') {
                    i += 1;
                    tmp = re_json_backslash_escapes.exec(string.slice(i, i + 5));
                    if (tmp) {
                        out += '\\' + tmp[0];
                        i += tmp[0].length;
                    } else {
                        return {
                            type: 'fail',
                            pos: i,
                            value: 'Invalid backslash sequence in the string starting at position #' +
                                     context + '; see http://www.json.org/string.gif for a list of ' +
                                     'allowed escape sequences.'
                        };
                    }
                } else {
                    return {
                        type: 'fail',
                        pos: i,
                        value: 'Reached end-of-line (or other control character) while trying to ' +
                                'parse the string starting at position #' + context + '. Control ' +
                                'characters have to be escaped with JSON syntax.'
                    };
                }
            }
            return {type: 'fail', pos: i, value: 'Unterminated string starting at position #' +
                    context + '. Reached end-of-input while trying to read it.' };
        });
        // parse.identifier handles variable names.
        parse.identifier = log('identifier', function () {
            var context = i, out = '';
            while (i < string.length && re_var_body.test(string[i])) {
                out += string[i++];
            }
            return {type: 'var', pos: context, value: out};
        });
        // parse.parens handles parenthesized subexpressions as well as the () void type. We match
        // Haskell by explicitly declaring that ( ) is OK for the void type, otherwise whatever is
        // inside just needs to be an expr.
        parse.parens = log('parens', function () {
            var context = i, out;
            i += 1; // skip past first '('
            parse.whitespace();
            if (string[i] === ')') {
                i += 1;
                return {type: 'null', pos: context, value: null};
            }
            out = parse.expr();
            if (out.type === 'fail') {
                return out;
            }
            if (string[i] === ')') { 
              i += 1;
              return out;
            }
            return {
                type: fail,
                pos: i,
                value: 'Expected to see ")", matching the "(" from position #' + context + '.'
            };
        });
        // simple whitespace skipper.
        parse.whitespace = log('whitespace', function () {
            while (i < string.length && re_whitespace.test(string[i])) {
                i += 1;
            }
        });
        // parse.expr parses a full expression including handling token-fails. It expects whitespace
        // to have already been skipped before the expression and it consumes all whitespace after
        // the expression, grabbing tokens until it receives a token-fail, at which point it assumes
        // that the expression is done. It knits those expressions together into a function call 
        // tree with left-associative priority.
        parse.expr = log('expr', function () {
            var context = i, out, p;
            // must always skip whitespace at the end for other checks above to be useful...
            p = parse.token();
            if (p.type === 'fail') {
                return p;
            }
            if (p.type === 'token-fail') {
                return {type: 'fail', pos: context, value: 'Expected an expression but saw nothing.'};
            }
            out = p;
            while (i < string.length) {
                parse.whitespace();
                context = i;
                p = parse.token();
                if (p.type === 'fail') {
                    return p;
                }
                if (p.type === 'token-fail') {
                    return out;
                }
                out = {type: 'apply', pos: context, value: [out, p]};
            }
            return out;
        });
        // now for the actual part where we parse the darn thing!
        // parse.expr requires whitespace to be skipped first, so that's the first order of business
        parse.whitespace();
        // then we grab an expression,
        final_output = parse.expr();
        // then we make sure that the expression is not a parse failure and that we have consumed
        // the entire string, otherwise there was some token-fail which the expr failed on, like if
        // one writes `abc "def" ]` and it gets to the `]` and can't build a token out of that.
        if (final_output.type !== 'fail' && i !== string.length) {
            return {type: 'fail', pos: i, value: 'I did not expect to see any further text after position #' + i + '; I just expected the end of the expression.'};
        }
        return final_output;
    };

    // show a type as a legible string. See kells.typeCheck for the array syntax of a Type.
    // when serializing this we have to convert each time we see `null` into a new name, which is
    // what the optional `vars` parameter does; this function mutates that parameter to allow new
    // variables to be persisted across multiple type signatures which are later combined, which is
    // precisely what happens in its recursive calls.
    function type_string(x, vars) {
        if (!vars) {
            vars = Object.create(null);
            vars.current_tmp_name = 0;
        }
        // limited type-variables so that the type of [[], []] is [[a]]. These are represented as ["[]", null].
        if (x === null) {
            let i = vars.current_tmp_name++;
            let s = String.fromCharCode('a'.charCodeAt(0) + (i % 26));
            while (i >= 26) {
                i = Math.floor(i / 26);
                s = String.fromCharCode('a'.charCodeAt(0) + (i % 26)) + s;
            }
            return s;
        }
        if (typeof x === 'string') {
            return x;
        }
        switch (x[0]) {
            case '[]':
                return '[' + type_string(x[1], vars) + ']';
            case '->':
                if (x[1][0] === '->') {
                    return '(' + type_string(x[1], vars) + ') -> ' +  type_string(x[2], vars);
                }
                return type_string(x[1], vars) + ' -> ' + type_string(x[2], vars);
            default:
                return x[0] + x.slice(1).map(
                    x => x instanceof Array && x.length > 1 ?
                        ' (' + type_string(x, vars) + ')' :
                        ' '  + type_string(x, vars)
                ).join('');
        }
    }
    kells.typeString = type_string;

    // unify two type expressions, throwing an embeddable error if they are diffferent (or a subexpression is different).
    function unify_types(a1, a2) {
        // limited type-variable handling in the form of nulls to support empty lists being polymorphic.
        if (a1 === null) {
            return a2;
        }
        if (a2 === null) {
            return a1;
        }
        if (typeof a1 === 'string') {
            a1 = [a1];
        }
        if (typeof a2 === 'string') {
            a2 = [a2];
        }
        // otherwise they are both arrays whose first element indicates the type constructor:
        if (a1[0] !== a2[0]) {
            throw new TypeError("no, " + type_string(a1) + " and " + type_string(a2) + " are fundamentally different");
        }
        if (a1.length !== a2.length) {
            throw new TypeError("software developer's error: type " + a1[0] + " has an inconsistent kind; it accepts both " + a1.length + " and " + a2.length + " type arguments");
        }
        return [a1[0]].concat(a1.slice(1).map((x, i) => unify_types(x, a2[i + 1])));
    }


    /** kells.typeCheck :: (ParseTree, Map Text Type, Maybe Text) -> Either TypeError Type
     * Internal calls to type_check_recursive pass around some {name: Text, type: Type}.
     * The actual type of `Type` above is either a JavaScript null or an Array of diverse elements.
     * The first element of the array is a string. The string "->" indicates a function from the second element
     * to the third. The string "[]" indicates a list of the second element. Any other string can be used to
     * indicate a custom type with no type-arguments (because we don't yet have the `data` keyword which lets
     * you specify how those things work.)
     *
     * The left-hand side of the error is thrown as an exception. These are sent through the pretty_error function
     * but this will only make it pretty if the source text is provided.
     */
    kells.typeCheck = function kells_typecheck(tree, base_lib, source) {
         function type_check_recursive(expr, lib) {
            var name, types, type, tmp, err_prefix;
            // the nice thing about the expression trees we use above is that you get switch statements for free.
            // we parse each of these into an intermediate form, {name: string, pos: number, type: $typeExpression},
            // where the `name` allows us to give even more personality to the error messages ("the `fireMissiles` 
            // function expects an integer, you tried to give it the string 'whenever'...").
            switch (expr.type) {
            case 'fail':
                throw pretty_error(SyntaxError, expr.value, expr.pos, source);
            case 'var':
                if (lib.hasOwnProperty(expr.value)) {
                    return {name: expr.value, type: lib[expr.value], pos: expr.pos};
                }
                throw pretty_error(ReferenceError, "I don't know what this word means: " + expr.value, expr.pos, source);
            case 'string':
                // make sure the name of the string isn't too long, otherwise the error message will be overwhelmed by that string!
                name = JSON.stringify(expr.value.length < 20 ? expr.value : expr.value.slice(0, 17) + "...");
                return {name: name, type: ['Text'], pos: expr.pos};
            case 'null':
                return {name: '()', type: ['()']};
            case 'list':
                // we want to first typecheck each of the values, then infer the most general unified type from all of them.
                // in this block `type` is going to actually be the subtype; we'll return type `['[]', type]` in the end.
                tmp = expr.value.map(x => type_check_recursive(x, lib));
                types = tmp.map(x => x.type);
                switch (types.length) {
                case 0:
                    name = '[]';
                    type = null; // this is a special wildcard value, mind.
                    break;
                case 1:
                    name = `[${tmp[0].name}]`;
                    type = tmp[0].type;
                    break;
                default:
                    name = '[' + tmp[0].name + ', ...]';
                    try {
                        type = types.reduce(unify_types, null);
                    } catch (e) {
                        // we can now discard `tmp`; the following usage just means that the type variables used in the
                        // arguments to a list will all be different if they have polymorphisms; so for example the list
                        // `[[], [], length]` generates an error, "A list's elements must all have the same type, the list 
                        // `[[], ...]` contains the types ([a], [b], [c] -> Int). When asked to merge these the type 
                        // system said: 'no, [a] and [a] -> Int are fundamentally different'."
                        tmp = {};
                        throw pretty_error(TypeError, "A list's elements must all have the same type. The list `" +
                                name + "` contains the types (" +
                                types.map(x => type_string(x, tmp)).join(", ") +
                                "). When asked to merge these, the type system said: '" + e.message + "'.", expr.pos, source);
                    }
                    break;
                }
                return {name: name, type: ['[]', type], pos: expr.pos};
            case "apply":
                // function application. we first want to get names and types for both the function
                // and its argument.
                tmp = expr.value.map(x => type_check_recursive(x, lib))
                types = tmp.map(x => x.type);
                // then we want to name this function application with both the names, and we just
                // need to know if we need to wrap the argument to the function application in 
                // parentheses, which we do if it's another function application:
                if (expr.value[1].type === 'apply') {
                    name = `${tmp[0].name} (${tmp[1].name})`
                } else {
                    name = `${tmp[0].name} ${tmp[1].name}`
                }
                // if the function itself is polymorphic, that's OK: specialize the `x` to a `y -> z`,
                // accept the input `y` wholesale, and then return the `z` type variable.
                if (tmp[0].type === null) {
                    type = null;
                } else {
                    // we're not quite ready to thrw an error yet, but let's get the first part of
                    // the error string ready:
                    err_prefix = `After \`${tmp[0].name}\` (position #${expr.value[0].pos}) I saw \`${tmp[1].name}\` (position #${expr.value[1].pos}), so the former is a function transforming the latter.\n    `;
                    // now we need the first element to be a function...
                    if (types[0][0] !== '->') {
                        throw pretty_error(
                            TypeError,
                            `${err_prefix}The problem is, it is **not** a function; it is a ${type_string(types[0])}. You may need some parentheses or commas?`,
                            expr.pos,
                            source
                        );
                    }
                    // ...and then we need its argument type to unify with the value type...
                    try {
                        unify_types(types[0][1], types[1]);
                    } catch (e) {
                        throw pretty_error(
                            TypeError,
                            `${err_prefix}That function expects an input of type ${type_string(types[0][1])}, but the thing you're transforming has type ${type_string(types[1])}.\n    When I asked the type system if these were the same, it said: ${e.message}.`,
                            expr.pos,
                            source
                        );
                    }
                    // and only if those succeed can we return the unified value...
                    type = types[0][2];
                }
                return {name: name, type: type, pos: expr.pos};
            default:
                throw pretty_error(SyntaxError, `Internal error: kells.js's type checker does not know how to handle a parse tree of type ${expr.type}.`, expr.pos, source);
            }
        }
        return type_check_recursive(tree, base_lib).type;
    };
    kells.linecolFromPos = linecol_from_pos;
    kells.prettyPrint = function kells_prettyprint(parse_tree, indent_width) {
        var indent = "", i;
        if (indent_width !== undefined) {
            for (i = 0; i < indent_width; i++) {
                indent += ' '
            }
        }
        function pretty_print_recursive(tree, line_prefix) {
            var tmp;
            switch (tree.type) {
                case 'var':
                    return tree.value;
                case 'string':
                    return JSON.stringify(tree.value);
                case 'fail':
                    return '[ERROR: ' + tree.value + ']';
                case 'null':
                    return '()';
                case 'list':
                    return '[' + line_prefix + indent +
                            tree.value.map(x => pretty_print_recursive(x, line_prefix + indent)).join(', ' + line_prefix + indent) +
                            line_prefix + ']';
                case 'apply':
                    tmp = pretty_print_recursive(tree.value[1], line_prefix);
                    return pretty_print_recursive(tree.value[0], line_prefix) + ' ' +
                            (tree.value[1].type === 'apply' ? '(' + tmp + ')' : tmp);
                default:
                    throw new Error(`Internal error: kells.js's pretty printer does not know how to handle a parse tree of type ${tree.type}.`)
            }
        }
        return pretty_print_recursive(parse_tree, indent_width === undefined ? '' : '\n').replace(/\s+\n/g, '\n');
    };
    kells.evaluate = function kells_evaluate(source, lib, type_lib, intended_type) {
        function eval_expr(expr) {
            var fn, a;
            switch (expr.type) {
            case "list":
                return expr.value.map(eval_expr);
            case "apply":
                fn = eval_expr(expr.value[0]);
                if (typeof fn !== 'function') {
                    throw pretty_error(EvalError,
                        "Encountered a " + (fn === null ? 'null value' : typeof fn) + " being used as a function.",
                        expr.pos,
                        source
                    );
                }
                try {
                    return fn(eval_expr(expr.value[1]));
                    /* lazy evaluation would go here and would look something like this:
                        let evaluated = 0;
                        let cache = null;
                        return fn(() => {
                            switch (evaluated) {
                                case 0:
                                    evaluated = 1;
                                    cache = eval_expr(expr.value[1]);
                                    evaluated = 2;
                                    return cache;
                                case 1: // evaluating the expression leads to an infinite loop.
                                    throw new Error("Infinite loop in a kells expression.");
                                case 2:
                                    return cache;
                            }
                        });

                    Except, we have to be careful with list expressions; the ideal form for these is
                    something like transforming [3,4] into:

                        () => {head: () => 3, tail: () => {head: () => 4, tail: () => null}}
                    */
                    return fn(eval_expr(expr.value[1]));
                } catch (e) {
                    throw pretty_error(EvalError, e.message, expr.pos, source);
                }
            case "string":
            case "null":
                return expr.value;
            case "var":
                if (lib.hasOwnProperty(expr.value)) {
                    return lib[expr.value];
                }
                throw pretty_error(ReferenceError, "Undefined variable: `" + expr.value + "`.", expr.pos, source);
            default:
                throw pretty_error(SyntaxError, `Internal error: kells.js's evaluator does not know how to handle a parse tree of type ${expr.type}.`, expr.pos, typeof source === string ? source : undefined);
            }
        }
        var parse_tree;
        if (typeof source === 'string') {
            parse_tree = kells.parse(source);
        } else {
            parse_tree = source;
            source = undefined;
        }
        if (parse_tree.type === 'fail') {
            throw pretty_error(SyntaxError, parse_tree.value, parse_tree.pos, source);
        }
        if (type_lib !== undefined) {
            if (intended_type === undefined) {
                intended_type = null;
            }
            let actual_type = kells.typeCheck(parse_tree, type_lib, source);
            try {
                unify_types(intended_type, actual_type);
            } catch (e) {
                throw pretty_error(TypeError, `I expected the overall expression to have type ${type_string(intended_type)} but it actually has type ${type_string(actual_type)}.`);
            }
        }
        return eval_expr(parse_tree);
    }
}());
