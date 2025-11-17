import fumifier from '../dist/index.mjs';
import assert from 'assert';
import chai from 'chai';

var expect = chai.expect;

describe('Invoke parser with valid expression', function() {
  describe('Account.Order[0]', function() {
    it('should return ast', async function() {
      var expr = await fumifier('Account.Order[0]', { recover: true });
      var ast = expr.ast();
      var expected_ast = {
        "type": "path",
        "errors": [],
        "steps": [
          {
            "value": "Account",
            "type": "name",
            "line":1,"position": 7, start: 0
          },
          {
            "value": "Order",
            "type": "name",
            "line":1,"position": 13, start: 8,
            "stages": [
              {
                "expr": {
                  "value": 0,
                  "type": "number",
                  "line":1,"position": 15, start: 14
                },
                "line":1,"position": 14, start: 13,
                "type": "filter"
              }
            ]
          }
        ]
      };
      var errors = expr.errors();
      var expected_errors = [];
      assert.deepEqual(ast, expected_ast);
      assert.deepEqual(errors, expected_errors);
    });
  });
});

describe('Invoke parser with incomplete expression', function() {
  describe('Account.', function() {
    it('should return ast', async function() {
      var expr = await fumifier('Account.', { recover: true });
      var ast = expr.ast();
      var expected_ast = {
        "type": "path",
        "errors": [
          {
            "code": "S0207",
            "line":1,"position": 8, start: 7,
            "token": "(end)"
          }
        ],
        "steps": [
          {
            "value": "Account",
            "type": "name",
            "line":1,"position": 7, start: 0,
          },
          {
            "type": "error",
            "error": {
              "code": "S0207",
              "line":1,"position": 8, start: 7,
              "token": "(end)"
            }
          }
        ]
      };
      var errors = expr.errors();
      var expected_errors = [
        {
          "code": "S0207",
          "line":1,"position": 8, start: 7,
          "token": "(end)"
        }
      ];
      assert.deepEqual(ast, expected_ast);
      assert.deepEqual(errors, expected_errors);
    });
  });

  describe('Account[', function() {
    it('should return ast', async function() {
      var expr = await fumifier('Account[', { recover: true });
      var ast = expr.ast();
      var expected_ast = {
        "type": "path",
        "errors": [
          {
            "code": "S0203",
            "line":1,"position": 8, start: 7,
            "token": "(end)",
            "value": "]",
            "remaining": []
          },
          {
            "code": "S0207",
            "line":1,"position": 8, start: 7,
            "token": "(end)"
          }
        ],
        "steps": [
          {
            "value": "Account",
            "type": "name",
            "line":1,"position": 7, start: 0,
            "stages": [
              {
                "expr": {
                  "type": "error",
                  "error": {
                    "code": "S0207",
                    "line":1,"position": 8, start: 7,
                    "token": "(end)"
                  }
                },
                "line":1,"position": 8, start: 7,
                "type": "filter"
              }
            ]
          }
        ]
      };
      assert.deepEqual(ast, expected_ast);
    });
  });

  describe('Account.Order[;0].Product', function() {
    it('should return ast', async function() {
      var expr = await fumifier('Account.Order[;0].Product', { recover: true });
      var ast = expr.ast();
      var expected_ast = {
        "type": "path",
        "errors": [
          {
            "code": "S0211",
            "token": ";",
            "line":1,"position": 15, start: 14,
            "remaining": [
              {"value": 0, "type": "number", "line":1,"position": 16, start: 15},
              {"type": "operator", "value": "]", "line":1,"position": 17, start: 16},
              {"type": "operator", "value": ".", "line":1,"position": 18, start: 17},
              {"type": "name", "value": "Product", "line":1,"position": 25, start: 18}
            ],
            "type": "error"
          },
          {
            "code": "S0202",
            "line":1,"position": 16, start: 15,
            "token": "0",
            "value": "]",
            "remaining": [
              {
                "value": 0,
                "type": "number",
                "line":1,"position": 16, start: 15
              }
            ]
          }
        ],
        "steps": [
          {
            "value": "Account",
            "type": "name",
            "line":1,"position": 7, start: 0
          },
          {
            "value": "Order",
            "type": "name",
            "line":1,"position": 13, start: 8,
            "stages": [
              {
                "expr": {
                  "code": "S0211",
                  "token": ";",
                  "line":1,"position": 15, start: 14,
                  "remaining": [
                    {"value": 0, "type": "number", "line":1,"position": 16, start: 15},
                    {"type": "operator", "value": "]", "line":1,"position": 17, start: 16},
                    {"type": "operator", "value": ".", "line":1,"position": 18, start: 17},
                    {"type": "name", "value": "Product", "line":1,"position": 25, start: 18}
                  ],
                  "type": "error"
                },
                "line":1,"position": 14, start: 13,
                "type": "filter"
              }
            ]
          }
        ]
      };
      assert.deepEqual(ast, expected_ast);
    });
  });

  describe('Account.Order[0;].Product', function() {
    it('should return ast', async function() {
      var expr = await fumifier('Account.Order[0;].Product', { recover: true });
      var ast = expr.ast();
      var expected_ast = {
        "type": "path",
        "errors": [
          {
            "code": "S0202",
            "line":1,"position": 16, start: 15,
            "token": ";",
            "value": "]",
            "remaining": [
              {"value": ";", "type": "operator", "line":1,"position": 16, "start": 15},
              {"type": "operator", "value": "]", "line":1,"position": 17, "start": 16},
              {"type": "operator", "value": ".", "line":1,"position": 18, "start": 17},
              {"type": "name", "value": "Product", "line":1,"position": 25, "start": 18}
            ]
          }
        ],
        "steps": [
          {
            "value": "Account",
            "type": "name",
            "line":1,"position": 7, start: 0
          },
          {
            "value": "Order",
            "type": "name",
            "line":1,"position": 13, start: 8,
            "stages": [
              {
                "expr": {
                  "value": 0,
                  "type": "number",
                  "line":1,"position": 15, start: 14
                },
                "line":1,"position": 14, start: 13,
                "type": "filter"
              }
            ]
          }
        ]
      };
      assert.deepEqual(ast, expected_ast);
    });
  });

  describe('Account.Order[0].Product;', function() {
    it.skip('should return ast', async function() {
      var expr = await fumifier('Account.Order[0].Product;', { recover: true });
      var ast = expr.ast();
      var expected_ast = {
        "type": "path",
        "steps": [
          {
            "value": "Account",
            "type": "name",
            "line":1,"position": 7, start: 0
          },
          {
            "value": "Order",
            "type": "name",
            "line":1,"position": 13, start: 8,
            "stages": [
              {
                "expr": {
                  "value": 0,
                  "type": "number",
                  "line":1,"position": 15, start: 14
                },
                "line":1,"position": 14, start: 13,
                "type": "filter"
              }
            ]
          },
          {
            "value": "Product",
            "type": "name",
            "line":1,"position": 24, start: 17
          }
        ]
      };
      var errors = expr.errors();
      var expected_errors = [
        {
          "code": "S0201",
          "line":1,"position": 25, start: 24,
          "remaining": [
            {
              "line":1,"position": 25, start: 24,
              "type": "operator",
              "value": ";"
            }
          ],
          "token": ";"
        }
      ];
      assert.deepEqual(ast, expected_ast);
      assert.deepEqual(errors, expected_errors);
    });
  });

  describe('$inputSource[0].UnstructuredAnswers^()[0].Text', function() {
    it('should return ast', async function() {
      var expr = await fumifier('$inputSource[0].UnstructuredAnswers^()[0].Text', { recover: true });
      var ast = expr.ast();
      var expected_ast = {
        "type": "path",
        "errors": [
          {
            "code": "F1100",
            "line":1,"position": 38, start: 37,
            "predicate": [
              {
                "expr": {
                  "error": {
                    "code": "S0207",
                    "line":1,"position": 46, start: 45,
                    "token": "(end)"
                  },
                  "type": "error"
                },
                "line":1,"position": 39, start: 38,
                "type": "filter"
              }
            ],
            "remaining": [
              {
                "line":1,"position": 39, start: 38,
                "type": "operator",
                "value": "["
              },
              {
                "line":1,"position": 40, start: 39,
                "type": "number",
                "value": 0
              },
              {
                "line":1,"position": 41, start: 40,
                "type": "operator",
                "value": "]"
              },
              {
                "line":1,"position": 42, start: 41,
                "type": "operator",
                "value": "."
              },
              {
                "line":1,"position": 46, start: 42,
                "type": "name",
                "value": "Text"
              }
            ],
            "token": ")",
            "matchingOpening": "(",
            "type": "error"
          },
          {
            "code": "S0203",
            "line":1,"position": 46, start: 45,
            "remaining": [],
            "token": "(end)",
            "value": "]"
          },
          {
            "code": "S0203",
            "line":1,"position": 46, start: 45,
            "remaining": [],
            "token": "(end)",
            "value": ")"
          },
          {
            "code": "S0207",
            "line":1,"position": 46, start: 45,
            "token": "(end)"
          }
        ],
        "steps": [
          {
            "value": "inputSource",
            "type": "variable",
            "line":1,"position": 12, start: 0,
            "predicate": [
              {
                "type": "filter",
                "expr": {
                  "value": 0,
                  "type": "number",
                  "line":1,"position": 14, start: 13
                },
                "line":1,"position": 13, start: 12
              }
            ]
          },
          {
            "value": "UnstructuredAnswers",
            "type": "name",
            "line":1,"position": 35, start: 16
          },
          {
            "type": "sort",
            "terms": [
              {
                "descending": false,
                "expression": {
                  "code": "F1100",
                  "token": ")",
                  "matchingOpening": "(",
                  "line":1,"position": 38, start: 37,
                  "remaining": [
                    {
                      "type": "operator",
                      "value": "[",
                      "line":1,"position": 39, "start": 38
                    },
                    {
                      "type": "number",
                      "value": 0,
                      "line":1,"position": 40, "start": 39
                    },
                    {
                      "type": "operator",
                      "value": "]",
                      "line":1,"position": 41, "start": 40
                    },
                    {
                      "type": "operator",
                      "value": ".",
                      "line":1,"position": 42, "start": 41
                    },
                    {
                      "type": "name",
                      "value": "Text",
                      "line":1,"position": 46, "start": 42
                    }
                  ],
                  "type": "error",
                  "predicate": [
                    {
                      "type": "filter",
                      "expr": {
                        "type": "error",
                        "error": {
                          "code": "S0207",
                          "line":1,"position": 46, start: 45,
                          "token": "(end)"
                        }
                      },
                      "line":1,"position": 39, start: 38
                    }
                  ]
                }
              }
            ],
            "line":1,"position": 36, start: 35
          }
        ]
      };
      assert.deepEqual(ast, expected_ast);
    });
  });

  describe('An expression with syntax error should not be executable', function() {
    describe('Account.', function() {
      it('should return ast', async function() {
        var expr = await fumifier('Account.', { recover: true });
        return expect(expr.evaluate({}))
          .to.be.rejected
          .to.eventually.deep.contain({position: 0, code: 'S0500'});
      });
    });
  });
});
