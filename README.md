# WOK Editor (Desktop Edition)

A minimalist, portable, and secure Markdown editor built with [Vditor](https://github.com/Vanessa219/vditor) and [Electron](https://www.electronjs.org/). This project is designed for a pure writing experience, focusing on performance, security, and core Markdown functionality.

## Core Features

-   **Minimalist & Portable:** No installer required. Just unzip and run.
-   **Full Markdown Support:** Utilizes Vditor for a rich Markdown editing experience, including CommonMark, GFM, and other extensions.
-   **Instant Rendering (IR) Mode:** Write and preview Markdown in a seamless, unified view.
-   **Security-First Design:**
    -   **Strict Content Security Policy (CSP):** Disables inline scripts and `unsafe-eval` to prevent cross-site scripting (XSS) attacks.
    -   **Sandbox Renderer:** The renderer process is sandboxed, isolating it from the Node.js environment for enhanced security.
    -   **Local-First Resources:** All Vditor assets are bundled locally, eliminating the need for external network requests and ensuring offline functionality.
-   **File System Integration:** Open, save, and manage Markdown files directly on your local machine.
-   **Auto-Save:** Automatically saves your work to prevent data loss.
-   **Customizable Interface:** Features like a resizable outline view enhance the user experience.

## Project Philosophy

The WOK Editor is guided by these principles:

1.  **Simplicity:** Provide a clean, distraction-free writing environment. The tool should be powerful but "disappear" into the background.
2.  **Security:** Implement modern security best practices (CSP, sandboxing) to create a safe application.
3.  **Offline & Local-First:** Ensure the editor is fully functional without an internet connection and that user data remains on the local machine.
4.  **Portability:** Avoid complex installation processes. The application should be easy to run from any location.

For more background, see the `项目策划案：Project WOK (Words to Knowledge).pdf` file.

## Getting Started (for Developers)

To set up a local development environment, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/zcanic/mkdw-editor-for-wok.git
    cd mkdw-editor-for-wok
    ```

2.  **Install dependencies:**
    This project uses `npm` for package management.
    ```bash
    npm install
    ```

3.  **Run the development server:**
    This command starts a Vite development server for the renderer process and launches the Electron application. It supports hot-reloading for rapid development.
    ```bash
    npm run dev
    ```

## Project Structure

Here is an overview of the most important files and directories:

```
.
├── electron/
│   ├── main.cjs       # Electron main process: window management, file system IPC, menus.
│   └── preload.cjs    # Electron preload script: securely exposes IPC APIs to the renderer.
├── public/
│   └── vditor/        # Bundled local assets for the Vditor editor.
├── src/
│   ├── main.js        # Renderer process entry point: Vditor initialization and UI logic.
│   └── style.css      # Global styles for the application.
├── index.html         # The HTML entry point for the renderer process.
├── package.json       # Project metadata, dependencies, and scripts.
├── vite.config.js     # Vite build configuration.
└── README.md          # This file.
```

## Available Scripts

The `package.json` file contains several scripts for development and building:

-   `npm run dev`: Starts the Vite dev server and Electron for development with hot-reloading.
-   `npm run build`: Builds the renderer process code using Vite into the `dist` directory.
-   `npm run preview`: Serves the production build locally for previewing.
-   `npm run electron`: Runs the Electron application using the existing build (if any).
-   `npm run electron:dev`: A convenience script that first builds the app, then runs it in Electron.
-   `npm run electron:pack`: Packages the application using `electron-builder` without rebuilding.
-   `npm run electron:dist`: Builds the renderer code and then packages it into a distributable format.
-   `npm run build:all`: A comprehensive script that builds and packages the application.

## Building and Distribution

To create a portable, distributable version of the application, run the following command:

```powershell
# Build and package for Windows (portable)
npm run electron:dist
```

This will generate a `release/win-unpacked/` directory. You can run the application directly by executing `WOK Editor.exe` from within this directory. No installation is needed.

## Technical Deep Dive

### Security (CSP & Sandbox)

The application implements a strict Content Security Policy to mitigate XSS risks. This is configured in `electron/main.cjs` and enforced in `index.html`. The policy disallows inline scripts and `unsafe-eval`, which required modifications to Vditor's default behavior (e.g., for code block copy buttons).

The renderer's `sandbox` is currently set to `false` to allow the preload script to use Node.js modules for creating the `contextBridge`. The goal is to migrate to a fully sandboxed environment in the future.

### Electron Main Process (`electron/main.cjs`)

The main process is responsible for:
-   Creating and managing the `BrowserWindow`.
-   Setting up the application menu.
-   Handling all file system interactions (open, save, save as) via IPC channels to ensure the renderer process does not have direct file system access.
-   Managing the application's lifecycle and state (e.g., unsaved changes).

### Renderer Process (`src/main.js`)

The renderer process handles the user interface:
-   Initializes the Vditor editor with a custom configuration.
-   Communicates with the main process via the `electronAPI` exposed by the preload script (`electron/preload.cjs`) for file operations.
-   Manages the editor's state, including content changes and "dirty" status.
-   Implements UI features like toasts and the resizable outline.

### Vditor Integration

Vditor is heavily customized to work within a secure, local-first Electron environment:
-   **Local CDN:** All Vditor assets are served from the `public/vditor` directory.
-   **CSP Compliance:** Inline event handlers (like `onclick`) are stripped from Vditor's generated HTML to comply with the CSP. Safe event listeners are attached instead.
-   **Feature Disabling:** Certain Vditor features that rely on external resources or `eval` (like PlantUML and ECharts) are disabled in the preview `transform` function.
-   **Image Upload:** The image upload handler is configured to read local images and embed them as Base64-encoded data URLs.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the [MIT License](LICENSE).