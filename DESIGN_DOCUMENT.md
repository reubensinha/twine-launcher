# Twine Launcher - Product Design Document

- This document defines the requirements for "Twine Launcher" (Name is subject to change)

## The Problem

1. Twine games store their save data in the browser cache. This means that if the browser cache gets cleared, which can happen with no fault from the user, then all save data will be lost
   - E.g.: The user stops playing for a couple months. When he open the game later, the browser has cleared the cache.
2. Twine games are run via html files. Mobile browsers (Android/iOS) do not handle running html files in the same way desktop browsers do.

## The Solution

- A dedicated application that runs hosts and runs twine games.

## App Requirements

- Automatically stores game save data outside of browser cache then restores it on launch.
- Standalone Windows Application
- Docker Container support
- App/WebUI should be able to be accessed from other devices/clients.
  - When accessed from other devices/clients, uses the same save data.
- Capable of hosting multiple games.
- Capable of launching multiple games simultaneously (No more than 1 instance of a specific game at a time to prevent save conflicts)

## Future Considerations

A list of features to be implemented in the future. Design the app in a way that makes it easy to implement these in the future.

- Multiple User support
  - Each user has their own save data for each game.
  - Multiple users can play the same game at the same time, with no risk of save data conflicts.
- Shortcut support
  - Allow games to be saved as shortcuts on windows
- Playnite Library add-on
  - A Playnite add-on that automatically adds games on Twine Launcher to Playnite, and launches those games via Twine Launcher.
  - Should support both Windows App and Docker Container.
- Git support
  - Add Twine games to Twine launcher by passing git url (github, gitlab, etc.)

## Other Considerations

(TBD)

## Things to be decided

- Programming Language
- Database
- API?
- Sync/Async
- Security?
- Everything Else
