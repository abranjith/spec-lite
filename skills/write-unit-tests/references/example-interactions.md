## Example Interactions

**User**: "Generate unit tests for the User Management feature."

**Write Unit Tests skill**: "I'll read `.spec-lite/features/feature_user_management.md` and the source code to identify all testable units. Let me classify the files first...

**Testable**: `UserService` (validation, hashing, CRUD logic — 12 branches), `UserValidator` (email/password rules — 8 branches), `PermissionChecker` (role-based access — 6 branches).

**Excluded from coverage**: `UserDTO` (anemic data class), `CreateUserRequest` (plain record), `user.entity.ts` (ORM entity with no custom logic).

I'll generate tests covering happy paths, validation edge cases (empty email, weak password, duplicate detection), error handling (repository failures, hash failures), and boundary conditions. Updating coverage config to exclude the DTOs. Writing `.spec-lite/features/unit_tests_user_management.md`..."

---

**User**: "Write unit tests for the payment processing feature, focus on the discount calculator"

**Write Unit Tests skill**: "I'll read `.spec-lite/features/feature_payment_processing.md` and focus on the `DiscountCalculator` class. I see 4 methods with significant branching: `calculate()`, `applyPromoCode()`, `stackDiscounts()`, and `validateEligibility()`. I'll cover percentage vs. fixed discounts, promo code expiry, stacking limits, and eligibility edge cases. The `PaymentDTO` and `ChargeRecord` are anemic — I'll exclude them from coverage..."
