# Task 28 Dataset

This document details the synthetic dataset generated during Task 28 to train the AccessAudit remediation model.

## Characteristics
- **Size**: 500 synthetic examples
- **Content**: Synthetic accessible and inaccessible DOM structures mapped to strict JSON semantic remediation payloads conforming to the deterministic schema.

## Distribution
- **SIMPLE**: 75
- **ARIA**: 75
- **MULTI**: 150
- **STRUCT**: 125
- **ABORT**: 75

## Splits
- **Train**: 400
- **Validation**: 50
- **Internal test**: 50

## Dataset Construction & Quality Guarantees
- **Grouped Split**: Train, validation, and test splits were strictly segregated.
- **Normalized AST Fingerprint Strategy**: To prevent data leakage, components were bucketed by AST fingerprint.
- **Shared Fingerprints**: 0 shared AST fingerprints between splits.
- **Leakage Checks**: Strict overlapping tests ensured no evaluation contamination.
- **Schema Validation**: Every payload was strictly verified against the `pipeline_v6.js` Ajv schema.
- **SAFE_ABORT cases**: Cases where remediation cannot be performed safely were explicitly generated to teach the model boundary restraint.
- **Closed-Loop Ground-Truth Patch Validation**: The generation pipeline verified that applying the ground-truth payload against the synthetic source successfully parsed, modified the AST, and regenerated without compilation errors.
- **Global Axe Regression Check**: Verified that the generated patches successfully resolved Axe-core violations without introducing new ones.

## Hashes
- **Test Internal SHA256**: `8eca855734a277b94c96cda7ba3bdeba12033f1df0dad870401959ca9b6dec3d`
