# Newton School Placement Job Description Downloader

An automated Playwright script in JavaScript (Node.js) that launches Google Chrome, navigates your Newton School portal, filters all active and unapplied internship placement companies, and downloads their Job Descriptions (JDs).

---

## 🌟 Key Features

1. **Persistent Playwright Chrome Profile**:
   - Uses a dedicated profile stored in `playwright_profile/` inside this project.
   - Sign into Newton once in that Chrome window. The same profile and login are reused every time you run the script, even after closing Chrome.

2. **Smart Navigation**:
   - Automatically navigates to `https://my.newtonschool.co/dashboard`.
   - Locates and opens your **Internship** program.
   - Switches into the **Placement** section.

3. **Intelligent Company Filtering**:
   - Detects all company listings.
   - Skips companies to which you have already applied (`Applied`, `Submitted`, etc.), plus expired and closed listings.
   - Processes listings only when the portal marks applications open or shows a parseable future deadline.

4. **Reliable JD Extraction**:
   - If a direct JD PDF is provided, downloads and saves the PDF into `job_descriptions/`.
   - If the JD is shown in a modal/drawer, saves substantial JD text as Markdown (`.md`).
   - Generates a `summary.json` record for eligible companies, including listings where a JD could not be extracted.

---

## 📁 Project Structure

```
newton-placement-downloader/
├── index.js              # Main Playwright automation script
├── package.json          # Node.js dependencies and run scripts
├── playwright_profile/   # Persistent Newton login for the Playwright browser (ignored by git)
└── README.md             # Documentation & instructions
```

---

## 🚀 Getting Started

### Sign in once

Run `npm start`. Chrome opens with the project's fixed `playwright_profile/` data directory. Sign into Newton in that window; the profile stores the session locally and is reused on every later run. You do not need to remember or select a Chrome profile name. Close the Playwright Chrome window before starting another run.

### 1. Requirements
- Node.js (v18 or higher recommended)
- Google Chrome installed on your Mac

### 2. Run the Script
From the project directory:

```bash
cd /Users/rhythmjain/Desktop/newton-placement-downloader
npm start
```

*(Or simply `node index.js`)*

---

## 🛠️ Step-by-Step Flow

1. **First-time Login**:
   - Chrome will open in the selected profile. If Newton is already signed in there, the script proceeds without another login.
2. **Program & Placements**:
   - The script clicks into your Internship track and navigates to the Placements tab.
3. **Download**:
   - It iterates through all available job cards, identifies unapplied & active jobs, and saves their JDs into:
     `~/Downloads/Newton_Job_Descriptions`
4. **Summary**:
   - When completed, a summary table is printed to your terminal and saved to `~/Downloads/Newton_Job_Descriptions/summary.json`.
# portal-jd-download
