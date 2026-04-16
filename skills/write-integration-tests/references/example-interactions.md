## Example Interactions

**User**: "Generate integration tests for the Payment Processing feature."

**Write Integration Tests skill**: "I'll read `.spec-lite/features/feature_payment_processing.md` to understand the feature requirements, then the relevant plan (`.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`) for the testing conventions and architecture. I'll identify the integration boundaries: API → Payment Service, Payment Service → Stripe API, Payment Service → Database. I'll generate tests for each boundary covering happy path, error handling (Stripe declines, timeouts), and data integrity (payment records persisted correctly). Writing `.spec-lite/features/integration_tests_payment_processing.md`..."
