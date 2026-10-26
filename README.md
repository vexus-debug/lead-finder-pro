# Remix of Remix of Lead Finder Pro

Build a modern web application called Website Lead Finder.

Goal

The application helps users discover businesses from Google Maps using the SerpAPI Google Maps API. The purpose is to identify businesses that do not have a website so they can be contacted as potential web design clients.

Search

Allow the user to enter:

Business category (e.g. Dentist, Spa, Restaurant)

Location (City, State, Country)

Maximum number of leads to collect

When the user clicks Find Leads, call the SerpAPI Google Maps endpoint.

Rate Limiting

The application must respect the SerpAPI free plan.

Maximum 50 API requests per hour.

Display API requests used.

Display remaining requests.

Never exceed the hourly limit.

If the limit is reached, pause further requests and notify the user.

Lead Filtering

Only save businesses that meet ALL of these conditions:

Business name exists.

Address exists.

Website field is empty, null, or missing.

Exclude permanently closed businesses.

Exclude sponsored or advertisement listings.

Phone number, rating, reviews, latitude, and longitude should be collected when available but should not be required.

Duplicate Prevention (Critical)

The application must NEVER save duplicate leads.

Before saving any lead, compare it against every lead already stored in the local database.

Use the following matching priority:

Google Place ID (primary unique identifier)

Business Name + Full Address

Business Name + Latitude/Longitude (if available)

If a match is found, skip the lead automatically.

Repeated searches, overlapping searches, or searching the same location multiple times must never create duplicate records.

Lead Database

Store:

Business Name

Category

Address

Phone Number

Website (should be empty for saved leads)

Rating

Number of Reviews

Google Maps Link

Google Place ID

Latitude

Longitude

Search Category

Search Location

Date Added

Dashboard

Display:

Total Leads

New Leads Added Today

Total Businesses Scanned

Duplicate Leads Skipped

Businesses Without Websites

API Requests Used

API Requests Remaining This Hour

Search History

Save every search with:

Search Query

Location

Date

Businesses Scanned

Leads Saved

Duplicates Skipped

Lead Table

Include:

Search

Sort

Pagination

Multi-select

Delete selected leads

Copy phone number

Open Google Maps listing

Export selected leads

Export

Allow export to:

CSV

Excel

User Interface

Create a clean, modern SaaS-style dashboard with:

Responsive layout

Sidebar navigation

Dark mode

Dashboard

Search

Leads

Search History

Settings

Storage

Use a local SQLite database (or another lightweight local database) to persist leads between sessions. No authentication or user accounts are required.

Error Handling

Gracefully handle:

SerpAPI errors

Hourly rate limit reached

Invalid locations

Empty results

Network failures

Provide clear, user-friendly error messages.

Code Quality

Use TypeScript and write clean, production-ready code with reusable components, loading indicators, pagination, and efficient data handling.

The application must prioritize preventing duplicate leads and minimizing unnecessary API requests.



Here is my serpapi key

e5ebcb9f70191f52ad655a3e62fb2995c9fc71f4409451b22ea03b2c7b5f9ca6

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/04919a2d-7104-49d8-adbb-1e70e041c32c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
