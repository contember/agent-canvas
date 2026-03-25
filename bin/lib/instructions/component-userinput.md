# Component: UserInput

Free text input.

## Props

- `id` (string, required) — unique, used as key in feedback
- `label` (string, required) — question text
- `placeholder` (string) — hint text
- `required` (boolean) — prevents submit until filled

## Usage

```jsx
<UserInput id="constraints" label="Any constraints I should know about?"
  placeholder="e.g. must work with existing Redis setup" required />
```
