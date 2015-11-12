var assert = require('assert');
var assign = require('object-assign');

module.exports = function(options) {
    var loops = options.loopTags;

    assert(Array.isArray(loops), 'Expected options.loopTags to be an array of available loop tags.');

    var continuations = [];

    function isLoop(node) {
        return loops.indexOf(node.name) !== -1;
    }

    return function(node) {
        if (this.isLeaf) {
            return;
        }

        if (node.name === 'TMPL_CONTINUE') {
            var parents = this.parents;

            var closestLoopIndex = lastIndexOf(this.parents, function(parent) {
                return isLoop(parent.node);
            });

            var closestContentNodeIndex = lastIndexOf(this.path, function(segment, index, path) {
                return (
                    (index >= 2 && path[index - 2] === 'otherwise') ||
                    (index >= 3 && path[index - 3] === 'conditions')
                );
            });

            var unreachableContentIndex = (
                closestContentNodeIndex === -1 ?
                    -1 :
                    Number(this.path[closestContentNodeIndex])
            );

            var continuation = parents
                .slice(closestLoopIndex)
                .reduceRight(function(acc, parent) {
                    var parentNode = parent.node;
                    var parentType = parentNode.type;
                    var rootCondition, precondition;

                    if (parentType === 'ConditionBranch' || parentType === 'AlternateConditionBranch') {
                        // This code merges preconditions for successive TMPL_IF/
                        // TMPL_ELSIF checks. For example:
                        //
                        //     <TMPL_IF [% $condition_a %]>
                        //         ## ...
                        //     <TMPL_ELSIF [% $condition_b %]>
                        //         <TMPL_CONTINUE>
                        //     </TMPL_IF>
                        //
                        // becomes:
                        //
                        //     <TMPL_IF [% !$condition_a && $condition_b %]>
                        //
                        if (parentType === 'ConditionBranch') {
                            rootCondition = parent.parent.parent;
                            precondition = asExpression(parent.node.condition);

                            for (var i = (index(parent) - 1); i >= 0; i -= 1) {
                                precondition = binary(
                                    '&&',
                                    not(rootCondition.node.conditions[i].condition),
                                    precondition
                                );
                            }

                        // This part does the same as above, just adjusted for
                        // alternate condition, e.g.
                        //
                        //     <TMPL_IF [% $condition_a %]>
                        //         ## ...
                        //     <TMPL_ELSIF [% $condition_b %]>
                        //         ## ...
                        //     <TMPL_ELSE>
                        //         <TMPL_CONTINUE>
                        //     </TMPL_IF>
                        //
                        // becomes
                        //
                        //     <TMPL_UNLESS [% $condition_a || $condition_b %]>
                        //
                        } else {
                            rootCondition = parent.parent;
                            precondition = not(
                                rootCondition.node.conditions
                                    .map(function(branch) {
                                        return branch.condition;
                                    })
                                    .reduce(function(a, b) {
                                        return binary('||', asExpression(a), asExpression(b));
                                    })
                            );
                        }

                        acc.preconditions.push(precondition);
                        acc.index = index(rootCondition) + 1;

                        // Any trailing non-conditionally unreachable code should
                        // be removed.
                        if (unreachableContentIndex !== -1) {
                            var contentParent = parents[closestContentNodeIndex];

                            contentParent.update(
                                contentParent.node.slice(0, unreachableContentIndex)
                            );
                        }
                    }

                    return acc;
                }, {
                    index: -1,
                    preconditions: []
                });

            if (continuation.preconditions.length === 0) {
                // This part covers case when a wild unconditional `TMPL_CONTINUE`
                // appears, see `template.008.tmpl` in corresponding test folder.
                this.parent.update(
                    this.parent.node.slice(0, index(this))
                );
            } else {
                continuations.push(continuation);
            }
        }

        if (isLoop(node)) {
            this.after(function() {
                var updated = continuations.reduceRight(function(content, continuation) {
                    return content
                        .slice(0, continuation.index)
                        .concat({
                            type: 'Condition',
                            name: 'TMPL_UNLESS',
                            conditions: [
                                {
                                    type: 'ConditionBranch',
                                    condition: {
                                        type: 'Expression',
                                        content: continuation.preconditions.reduceRight(
                                            binary.bind(null, '&&')
                                        )
                                    },
                                    content: content.slice(continuation.index)
                                }
                            ]
                        });
                }, node.content);

                this.update(
                    assign({}, node, { content: updated }),
                    false
                );

                continuations = [];
            });
        }
    };
};

function asExpression(condition) {
    if (condition.type === 'SingleAttribute') {
        var identifier = '$' + condition.name;

        return {
            type: 'Identifier',
            name: identifier
        };
    } else {
        return condition.content;
    }
}

function binary(operator, a, b) {
    return {
        type: 'BinaryExpression',
        operator: operator,
        left: a,
        right: b
    };
}

function not(expression) {
    return {
        type: 'UnaryExpression',
        operator: '!',
        argument: expression,
        prefix: true
    };
}

function index(nodeContext) {
    return Number(last(nodeContext.path));
}

function last(list) {
    return list[list.length - 1];
}

function lastIndexOf(list, fn) {
    for (var i = (list.length - 1); i >= 0; i -= 1) {
        if (fn(list[i], i, list)) {
            return i;
        }
    }

    return -1;
}
