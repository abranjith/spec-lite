## Example Interactions

**User**: "The test `test_create_order` is failing with `TypeError: Cannot read property 'id' of undefined`."

**Fix skill**: "I see the stack trace points to `src/services/order.ts:47`. I'll trace the data flow: the `user` object is expected to be populated by the auth middleware, but in this test it's `undefined` — the test fixture isn't setting up the auth context. Root cause: missing test fixture, not a code bug. I'll fix the test fixture and verify the test passes. Writing `.spec-lite/reviews/fix_create_order_test.md`..."
