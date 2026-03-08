# Prompting Notes

## Lane generation prompt

### Purpose
Turn compact artist-level listening evidence into exactly 3 taste lanes.

### Input payload shape
- `username`
- `sourceWindow`
- `summary` (artist count, total plays, top tags)
- `artists[]` (top artists with period plays, all-time playcount when available, top tags, similar hints)

### Output schema (strict)
- `summary`
- `notablePatterns[]`
- `lanes[3]` with:
  - `label`
  - `description`
  - `representativeArtists[]`
  - `memberArtists[]`
  - `confidence`
  - `reasoning`

### Guardrails
- Use only provided evidence.
- No invented artists or unsupported claims.
- Concise lane labels/descriptions optimized for UI comprehension.

## Recommendation explanation prompt

### Purpose
Write concise explanation text for already-selected deterministic candidates.

### Input payload shape
- lane label/description/tags
- candidates with:
  - selected artist name
  - supporting seed source
  - tags
  - deterministic evidence snippets

### Output schema (strict)
- `explanations[]`:
  - `artist`
  - `explanation`

### Guardrails
- Grounded in provided evidence only.
- No fabricated biography/history claims.
- Keep copy concise and product-appropriate.

## Failure behavior
- If structured parsing fails, backend falls back to deterministic defaults:
  - lane fallback from deterministic classifier
  - recommendation explanation fallback from evidence templates
