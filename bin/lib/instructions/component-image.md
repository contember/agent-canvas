# Component: ImageView

Displays an image from the project directory.

## Props

- `src` (string, required) — path relative to project root
- `alt` (string) — alt text
- `caption` (string) — caption displayed below image
- `width` (number) — max width in pixels

## Usage

```jsx
<ImageView src="docs/architecture.png" />
<ImageView src="screenshots/before.png" alt="Before refactor" caption="Current state" width={600} />
```
