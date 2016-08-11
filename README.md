# kells.js
`kells` is an abridged form of Haskell used to build flexible, pretty DSLs. This package is a parser
for `kells`, defines the language, and provides an evaluator if you provide a dict of primitive
symbols (for functions and the like), and the evaluator can be used to typecheck programs if you can
pass a dict of those symbols' types. With hope this will graduate from simple expression parsing to
also allowing definitions, recursion, and other such special syntax.

With a capital-K, Kells is the name of the kingdom in which Saban's series *Mystic Knights of Tir Na
Nog* takes place, in case you are using `kells` and you want a project name. Write something evil
with `kells` and call it `maeve` or `mider`, for example. But the name originally was intended to be
something like "`kell-s`: half-of-Has**kell** **s**cripting language."

You can also help by porting `kells` to other languages like Python.

# What's there so far?
The basic kells expressions are:

  * Variable identifiers, starting with a lowercase letter or underscore and then containing
    anything from the character class `[a-zA-Z0-9_']`.
  * Strings, following JSON syntax exactly.
  * A null value, represented by empty parentheses `()`, possibly with whitespace inside.
  * Lists of other kells expressions. These start with a `[` and end with a `]` which can both be
      padded with whitespace. A list contains 0 or more subexpressions separated by commas, which
      can also be optionally padded with whitespace.
  * Parenthesized sub-expressions, which can also be padded with whitespace and are used to control
    the order of operations.
  * Applications, which consist of 2 terms written with whitespace between them. The term on the
    left is interpreted as a function and the one on the right is its argument. Like Haskell, it is
    expected that multiple arguments will be handled with currying.

Like in Haskell, function application is left-associative or *aggressive nom*: a function will eat
the very first thing it sees in front of it, deferring only to parentheses and list syntax. If you
want to write what is, in Javascript, `f(g(x, y), z)` this is first off curried to give
`f( g(x)(y) )(z)` and then written `f (g x y) z` by these rules. If you have never seen currying
before, it is the higher-order function:

    function curry2(fn) {
        return function (x) { return function (y) { return fn(x, y); }; };
    }

which guarantees that if `h = curry2(g)`, then `g(x, y) == h(x)(y)`. It's just a different way to
deal with having multiple arguments.

# Why Haskell?
Well, the parser for JavaScript-in-JavaScript would've been hard, I couldn't bear to use an `eval`,
and the semantics for PHP look damn near impossible. So I had to make my users learn something new
*anyway* to control a certain beast of a process. Now the easiest thing parser-wise would of course
have been a lisp, but if you include Haskell list syntactic sugar then Haskell has almost-as-simple
syntax in its basic expressions, and looks a bit cuter without the leading parentheses used to
denote function application.

# What's missing?
If you know Haskell you're going to be somewhat disappointed: right now it varies from Haskell by
lacking operators, constructors, numbers, module-namespaces, and special forms like `let`, `where`,
and `case`. Furthermore, it takes its strings entirely from JSON, rather than using the Haskell
format for them. So those things do leave it feeling a bit neutered, and are all in the "eventually
those things would be nice to add back" category. List literals are treated internally as JavaScript
lists rather than by providing Haskell's lazy-list abstraction with its syntactic sugar.

Typeclasses don't exist and would be nice; furthermore the type language does not allow you to
match two variables in different parts of an expression. List comprehensions and ranges don't exist
either. Stuff like monads and do-notation falls under "has no special forms and no typeclasses"
above. It certainly has no Prelude or other builtin functions: it is missing a lot. Do not think of
it as a Haskell alternative or anything. It's a syntax for DSLs, more of an alternative to XML or
writing s-expressions in JSON. It's a lightweight library to turn this block of text:

    reminders [
        task "Do the dishes" "2016-08-11 13:00:00",
        task "Feed the bunnies" "2016-08-11 20:00:00"
    ]

with a `lib` in which `lib.reminders` and `lib.task` are defined as functions, into this tree of
function calls:

    lib.reminders([
        lib.task("Do the dishes")("2016-08-11 13:00:00"),
        lib.task("Feed the bunnies")("2016-08-11 20:00:00")
    ]);

To add operators I will need to switch to a GLL or top-down-operator-precedence parser; to get lazy
evaluation I probably should add operators and make list-syntax into syntactic sugar for the list
construction operator; and to add proper bona-fide typechecking, I probably want to embed a logic
programming sublanguage like microKanren. So those are maybe coming.

The lack of numbers is a huge gaping hole; I didn't want to add them before I committed to whether
we were going to do integers, bigints, rationals, or doubles for them (or some mixture like Haskell)
and even then, whether we're going to make them polymorphic.

# How do I use it?
So the general idea is to take a string and parse it into a tree, which represents what this code
is trying to do. That's `kells.parse`. You can then typecheck a tree against a JSON type language,
that's `kells.typeCheck`. Then you can walk the parse tree to evaluate an expression. If you want,
you can do all of these (or some of them) in one go with `kells.evaluate`, which lets you just
define what the top-level functions in your language are going to be.

In the following discussion I'll mention some JavaScript type signatures by the name of their
`typeof` (string, number, undefined) or their own value (null), with the infix pipe operator `|`
meaning that either of two is accepted, a postfix `?` operator `x?` meaning `(x) | undefined`.
Arrays in JavaScript are written `[subtype]` with the subtype they contain; functions are given
with parameter identifiers for documentation: so `(name1: type1, name2: type2, ...) -> out_type`
is the type of  a function whose first argument has type `type1` and whose second argument has type
`type2`, etc. -- and the names `name1`, `name2` technically don't matter to JavaScript and are just
to help me document things. Objects can either be dictionaries specified with `dict(subtype)` (like
lists, users are meant to make this as big or small as they want; we'll use the keys to look up
values) or objects with fixed properties specified with curly braces like in JavaScript, with the
right hand side being the types of those properties. I may sometimes write an underscore as an
arbitrary type.

Some types start with a dollar sign and are being defined like so:

    $parseTree = {type: string, value: string | null | [$parseTree], pos: number}
    $typeSignature = null | [string | $typeSignature]

In other words a `$parseTree` is an object with three keys, `type` is a string, `pos` is a number,
and `value` is either a `string` or a `null` or a list of other `$parseTree`s depending usually on
what the `type` was. A `$typeSignature` can either be a `null` or else a list which contains either
`string`s or more `$typeSignature`s.

An arrow (for a function signature) can contain prefixes: `&` means that the fuction can be
reasonably expected to throw an exception; `!` means that the function is not functional (in the
technical sense: it's either nondeterministic or it has side-effects).

## kells.parse :: `(source: string) -> $parseTree`
This takes a string holding a kells expression and converts it to a `$parseTree` as defined above.
The `type` is a syntactic type entirely unrelated to the type libraries that you're writing for
`kells.typeCheck`. The `value` holds type-dependent info, usually sub-expressions, and the `pos` is
an integer specifying the index in the string where this parse result begins, for better error
messages.

Here are the `type`s of expressions that make up a ParseTree:

 *  `var`: a variable reference; the `value` is a string.
 *  `string`: a string literal; the `value` is the JSON-decoded string.
 *  `fail`: a parse failure; the `value` is an error message saying what went wrong. This should
    always be propagated to being a top-level error and should never be nested.
 *  `null`: the singleton void type in kells; the value is JavaScript `null`.
 *  `list`: a list expression; the value is a JavaScript array of subexpressions.
 *  `apply`: a function application; the value is a JavaScript array containing exactly two
    subexpressions. The first is the expression for the function; the second is the expression for
    its argument.

## kells.linecolFromPos :: `(source: string, pos: number) -> {line: number, col: number}`
Turn a `pos` as seen in the ParseTree into a (line, col) pair within the submitted document by
scanning through it to count newlines. Again, this is to facilitate better error reporting.

## kells.prettyPrint :: `(tree: $parseTree, indent_level: number?) -> string`
Turn a `$parseTree` into a single-line string, or a multi-line string with the requisite number of
spaces as indents if the indent_level is specified. This will remove superfluous parentheses and
normalize to just one space in function application.

## kells.typeString :: (type: $typeSignature) -> string
Pretty-printing for type signatures.

## kells.typeCheck :: `(tree: $parseTree, base_lib: dict($typeSignature), source: string?) &-> $typeSignature`
This will validate an expression against a type dictionary. As mentioned above, the dictionary maps
words (in the domain-specific language you're creating) to type signatures. Failures to match up
intermediary types will come out as thrown exceptions.

Signatures are essentially written in JSON with S-expressions; they can be any of three things:

 *  A `null` value, representing a wildcard. These wildcards cannot be matched against each other,
    like in `id :: a -> a` where two type variables are constrained to be the same. That may come
    in a future version; this was just needed to type the empty list in-process as `['[]', null]`
    since we don't have a proper logic programming language here.
 *  A string. This is pure syntactic convenience; if `s` is a string then it is equivalent as a type
    signature to the more-proper signature `[s]`.
 *  An array whose 0th element exists and is a string.
     *  The string `->` requires 2 more elements which are type signatures; it represents functions
        from things of the the 1st type to things of the 2nd type.
     *  The string `[]` requires 1 more element which is a type signature; it represents lists of
        things of the 1st type.
     *  The string `Text` will match the built-in string type.
     *  The string `()` will match the built-in null type.
     *  Other strings are not built-in but you can of course use them; some of your library
        functions can return something of type X and other library functions can consume it. So for
        example in Blue Chair's trigger-language this was originally defined for, we had a top level
        data type of `Rule`; there were functions `Text -> Rule` and other functions 
        `[Rule] -> Rule` to combine them, but the expressions were not allowed to "peek inside" of
        a `Rule` to figure out the JS code that makes them work.

Naturally when `kells` gets operators the idea is for a `$typeSignature` to also become a
`$parseTree` that is written normally as a string in `kells`, similar to how Haskell behaves.

## kells.evaluate :: `(expr: string | $parseTree, lib: dict(_), type_lib: dict($typeExpression)?, intended_type: $typeExpression?)
The function `kells.evaluate` takes a parse tree and a dictionary mapping identifiers to values.
When the parse tree calls for a function application, it uses strict semantics, evaluating first the
function expression and second the argument, and then feeds that argument to the function.

You may optionally provide a type library and an intended type, and before the expression is
evaluated it will be typechecked. You may optionally provide the expression as a string of kells
code, in which case it will be parsed into the parse tree before any of this stuff happens.
