# Temporary picomatch security patch

Vendored from npm picomatch 4.0.7 (MIT; LICENSE retained), tarball SHA-1
6313360034ccb36b3dc61ecbdff78121f90fe21f.

GHSA-fc5q-39xc-vjpf / CVE-2026-112366 has no published patched version as of
2026-11-17. Single-branch repeated extglobs such as `+(*)` and `+(*a)` bypass
upstream's multi-branch risk check and emit nested unbounded quantifiers.

The sole parser change extends the existing risky-pattern literalization to
single branches containing wildcard/quantifier characters `* ? + {`.
This is conservative: some safe complex single-branch repeats also become
literal patterns. Ordinary globstars, braces and literal alternatives are
unchanged. Existing explicit maxExtglobRecursion:false remains an unsafe opt-out;
no CRM build consumer uses it. Tests run vulnerable shapes in a timeout-bound
child and verify all installed consumers resolve this patched package.

Use the scoped private package identity to distinguish this fork from unpatched
upstream. The npm audit gate stays enabled. Replace the vendored package and
override when an upstream security fix is published and compatibility is tested.
