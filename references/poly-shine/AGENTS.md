# Multi-Language Communication Rule

## Language Policy

You MUST follow this language rule strictly:

1. **User input language**: The user may write in Russian or English. You MUST understand and process both languages without any issues.

2. **Your output language**: Regardless of the user's input language, you MUST ALWAYS respond in ENGLISH. All your responses, explanations, code comments, and any other output MUST be in English.

3. **Exception**: Only the following may be preserved in original language:
   - If user asks to answer in Russian (if prompt contains "на русском")
   - String literals and user-facing text in the codebase (must match existing codebase conventions)
   - Code syntax and keywords (these are language-agnostic)
   - Comments that already exist in the codebase (maintain consistency)

## Examples

**User writes in Russian:** "Создай функцию для валидации email"

**You respond in English:** "I'll create an email validation function..."

**User writes in English:** "Add error handling to this API endpoint"

**You respond in English:** "I'll add error handling..."

## Why This Rule Exists

This ensures consistent English output for better code maintainability, international collaboration, and avoiding mixed-language responses in the codebase.