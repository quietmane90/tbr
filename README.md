# TBR: a reading tracker for your phone

A free reading tracker that installs to your home screen like an app. It tracks what you're reading, what's up next, and your reading log, and makes shareable monthly and yearly roundups sized for Instagram. Everything is saved on your own device. There are no accounts and no server.

## Features
- **Reading:** what you're reading now, an Up next queue you can drag to reorder, and stats for the year.
- **Log:** filter by year and month, and drag books into the order you read them.
- **Roundups:** monthly or yearly images with covers and star ratings, in 1:1, 4:5, 3:4 and 9:16.
- **Library:** books grouped by series, sorted by priority, with standalones shown on their own.
- **Quick add:** type a title and author, scan a cover photo, or add a whole series at once. Pick a priority and the rest is filled in.
- **Covers:** found automatically from Open Library, Apple Books and Google Books. You can also use your own photo.
- **New releases:** about once a week, the app checks for new and upcoming books from the authors you read, and marks books as released once they're out.
- **Import:** bring in your library from Goodreads, StoryGraph or Libby. You review every book before it is added, and missing series are filled in automatically.
- **Find on:** jump to a book on Amazon/Kindle, Apple Books, Kobo, Audible, Spotify, Libby, Goodreads or StoryGraph.
- **Backup:** save your library to a file, and restore it on a new phone.
- **Offline:** works without a connection once it's installed.

## Put it online with GitHub Pages (free)
1. Create a free account at github.com.
2. Click **New repository**. Name it something like `tbr`, set it to **Public**, and click **Create repository**.
3. On the new repository page, click **uploading an existing file**. Drag in everything from this folder, including the `icons` folder and the `.nojekyll` file, then click **Commit changes**.
4. Go to **Settings**, then **Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main**, and folder to **/ (root)**. Click **Save**.
5. After a minute or two, the app is live at `https://YOUR-USERNAME.github.io/tbr/`.

## Install on a phone
- **iPhone:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in Chrome, tap the **⋮** menu, then **Install app**.

## Updating the app
Edit or replace files in the repository. Then open `sw.js` and change the version in `CACHE` (for example `tbr-v1.0.1`). People get the update the next time they open the app twice.

## Privacy
Each person's library stays in their own browser. The app only contacts Open Library, Apple Books, Google Books, Wikidata and Google Fonts to look up books and covers.
