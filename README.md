# redpen

A lightweight, zero-setup tool for grading student code submissions with inline annotations. Designed for teachers to provide clear, Genius.com-style inline feedback that is easy to read, completely self-contained, and works fully offline.

## Overview

**redpen** operates in two simple modes:
- **Author mode** — The grading app itself. A teacher uses this to paste student code, highlight specific regions, write markdown comments, add tags, and export the graded file.
- **Viewer mode** — The exported HTML file. This is a self-contained, read-only document that the student opens in any browser to see their grade and click on highlights to read feedback.

## Features

- **Inline Annotations**: Highlight exact characters (spans), multiple lines, or entire structural blocks of code.
- **Markdown Support**: Write formatting, lists, links, and code snippets inside your comments.
- **Color-coded Tags**: Categorize your feedback (e.g., "Logic", "Style", "Good") with customizable color tags.
- **Self-contained Export**: Generates a single HTML file containing the code, formatting, and feedback—with no external dependencies.
- **Fully Offline**: No servers, no accounts, and no student data leaving your machine.
- **Zero Setup**: No installation required. Just open the app in your browser and start grading.

## How to Use

### 1. Starting redpen
There is no installation required. To use redpen:
1. Download or clone this repository to your computer.
2. Double-click the `index.html` file to open it in any modern web browser (Chrome, Firefox, Safari).

### 2. Grading a Submission
1. **Paste Code**: Copy the student's source code and paste it into the main text area.
2. **Set Details**: Fill out the student's name, assignment name, programming language, and the final score in the top bar.
3. **Add Annotations**:
   - Select the text you want to comment on with your mouse.
   - Click the floating **"+ Comment"** button that appears.
   - Write your feedback and apply relevant tags.
4. **General Feedback**: You can also provide an overall assignment comment in the right sidebar.

### 3. Exporting & Sharing
1. Once you are finished grading, click the **"Export HTML"** button in the top right.
2. A single HTML file (e.g., `studentname_assignment_redpen.html`) will be downloaded.
3. Send this exported file to the student!

### 4. Viewing Feedback (Student)
When the student receives the file:
1. They double-click it to open it in their own browser.
2. They will see their code with highlighted sections.
3. Clicking on any highlighted text will pop up a tooltip containing the teacher's exact feedback.
