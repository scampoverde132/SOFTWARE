# WL Painting AI Automation Operating System

## Executive decision

WL Painting should build one governed operating system, not a collection of disconnected automations.

### Recommended architecture

- **Odoo Online Custom** - system of record for CRM, contacts, opportunities, quotations, projects, tasks, timesheets, change orders, invoicing, and executive reporting.
- **Self-hosted n8n** - orchestration layer for Outlook intake, source integrations, AI routing, approvals, reminders, synchronization, retries, and audit events.
- **WL PT Tool / PlanTakeoff** - estimating workstation for plan review, takeoff, quantities, estimate logic, and proposal support.
- **OneDrive / SharePoint** - authoritative document repository for plans, photos, estimates, contracts, submittals, change orders, invoices, and closeout files.
- **Outlook estimator01** - monitored intake channel for Yelp leads, invitations to bid, customer messages, addenda, awards, contracts, and project communications.
- **Discord** - optional rapid alert and approval surface. It is not the system of record. Every decision must be written back to Odoo with approver, timestamp, decision, and comments.
- **AI gateway** - routes tasks to Grok, ChatGPT, or another approved model based on cost, sensitivity, and quality. Models may extract, classify, summarize, compare, draft, and flag. Models may not independently approve prices, contracts, change orders, invoices, or legal commitments.

## Current repository audit

The repository already contains useful foundations:

- Local bid-folder scanning and project-folder creation.
- Plan classification and sheet-name parsing.
- Takeoff and estimating functions.
- Grok PowerShell and xAI REST integration.
- Phase, task, and budget-variance models.
- Early BuilderTrend-style project concepts.

Material gaps:

1. The folder template centers on Drawings, Estimates, Pictures, and Notes. It does not yet represent prequalification, contracts, schedules, daily reports, timesheets, change orders, billing, collections, or closeout.
2. The local API lacks an Odoo integration service, synchronization queue, webhook receiver, audit-event model, retry policy, and dead-letter queue.
3. The multi-phase templates are generic construction templates. WL Painting needs painting-specific work packages: mobilization, protection, preparation, walls, ceilings, doors and frames, specialty coatings, wallcovering, exterior, punch, and closeout.
4. Record ownership is undefined. Odoo, WL PT Tool, Outlook, and file storage must not overwrite one another.
5. Human approval rules, service accounts, permissions, backup, disaster recovery, and automation monitoring are not yet implemented.

## Record ownership

| Business object | Authoritative system | Integration rule |
|---|---|---|
| Lead and opportunity | Odoo CRM | n8n creates or updates; Discord alerts only |
| Customer and contacts | Odoo Contacts | n8n normalizes and deduplicates |
| EST number | Odoo sequence service | WL PT Tool and folders consume it |
| Plans and project files | OneDrive / SharePoint | Odoo stores links and metadata |
| Takeoff quantities | WL PT Tool | Approved estimate summary syncs to Odoo |
| Proposal and revisions | Odoo Sales / Documents | WL PT Tool supplies scope and estimate data |
| Project schedule and tasks | Odoo Project / Planning | Foreman mobile input updates progress |
| Employee time | Odoo Timesheets | Foreman submits crew time daily |
| Change orders | Odoo Sales / Project | Supporting files remain in project folder |
| Invoices and payments | Odoo Accounting | n8n sends reminders and exceptions |
| Automation audit | n8n database plus Odoo chatter | Every workflow uses a correlation ID |

## Permanent identifiers

Every workflow must carry the same identifiers:

- `lead_id` - Odoo CRM lead or opportunity ID.
- `est_number` - permanent bid number such as `EST2608001`.
- `project_id` - Odoo project ID after award.
- `customer_id` - Odoo partner ID.
- `source_message_id` - Outlook, Yelp, Google, Meta, or form source identifier.
- `document_folder_url` - authoritative project-folder link.
- `automation_run_id` - n8n execution or correlation ID.

No automation may create a second record when the same source identifier or normalized customer/project combination already exists.

# Fifteen governed automations

## 1. Omnichannel lead intake and deduplication

**Triggers:** Outlook estimator01, Yelp, website forms, Google Ads lead forms, Meta lead forms, BuildingConnected, Procore, and manual entry.

**Flow:** preserve the raw source payload; extract contact, company, phone, email, address, project, scope, due date, source, attachments, and message; normalize fields; search Odoo for duplicates; create or update the opportunity; store the original evidence; assign an extraction-confidence score.

**Human gate:** only low-confidence, conflicting, suspicious, or duplicate-candidate records enter the exception queue.

**SLA:** high-intent lead unassigned after 10 minutes alerts the office; after 30 minutes escalates to management.

## 2. AI qualification and missing-information recovery

Classify commercial versus residential, core versus non-core scope, geography, project type, urgency, decision-maker quality, bid due date, estimated value band, and strategic fit. Produce `Pursue`, `Review`, or `Decline`, identify missing plans/specifications/access/schedule/contact data, draft the information request, and create Odoo activities. A human approves the final disposition.

## 3. Lead approval, assignment, and distribution

Create an Odoo approval card and optional Discord card containing source, client, location, scope, due date, fit score, risk flags, estimated revenue band, and recommended owner. Authorized actions are `Accept`, `Decline`, `Need Information`, `Assign`, and `Escalate`. n8n validates the approver identity and writes the decision to Odoo chatter.

## 4. First-contact and follow-up SLA engine

Start the first-contact clock when a lead is accepted. Draft email, text, and call scripts; detect sent email or logged calls; remind the assignee; escalate overdue records; require an outcome; and schedule the next activity. Track speed-to-lead, contact rate, attempts, overdue activity, and conversion after first contact.

## 5. Site-visit scheduling and field intake

Check technician availability, offer appointment windows, create calendar events, send confirmations and reminders, and generate a mobile site-visit form. Require photos, measurements, existing conditions, access constraints, customer priorities, exclusions, schedule, and unresolved questions. A visit cannot close without required evidence or a documented exception.

## 6. Prequalification and compliance package

Maintain a controlled company profile containing W-9, insurance, licenses, MBE documentation, safety records, banking references, bonding letter, capability statement, past performance, and expiration dates. When a customer requests prequalification, assemble the correct package, assign missing items, obtain approval, submit, and track expiration or renewal. Sensitive financial documents require restricted access.

## 7. Bid calendar, deadline, and addenda control

Extract bid dates, pre-bid meetings, RFIs, addenda, alternates, submission portals, contacts, and time zones. Create Odoo milestones and calendar events. New addenda trigger a revision task and block submission until acknowledged. Escalate deadlines at 72, 24, 4, and 1 hour. A bid cannot be marked submitted without evidence of delivery.

## 8. Plan/specification ingestion and takeoff handoff

Create the EST number and standardized folder, save plans/specifications/addenda, deduplicate files, preserve revisions, and pass the drawing set to WL PT Tool. Require full-sheet reading, finish-schedule correlation, scope-gap audit, RFI register, takeoff quantities, and evidence references. The final estimate package syncs summarized scope, quantities, exclusions, and pricing to Odoo.

## 9. Estimate QA, risk, and margin approval

Before proposal generation, validate scope completeness, quantities, units, coverage, waste, labor production, material pricing, equipment, subcontractor quotes, alternates, tax, escalation, exclusions, schedule risk, and contract risk. Compare against historical production. Apply approval thresholds by value, margin, unusual terms, and confidence. AI flags anomalies but cannot approve the price.

## 10. Proposal generation, revision, and submission

Generate the WL Painting proposal from approved estimate data, include scope, alternates, clarifications, exclusions, schedule, validity, and revision number, then route it for approval. Submit through the required channel, capture proof of delivery, freeze the submitted revision, and create the follow-up activity. Every later revision retains a complete audit trail.

## 11. Bid follow-up, outcome, and loss intelligence

Create timed follow-ups after submission, detect responses, record budget requests and best-and-final requests, and require a final outcome: awarded, lost, no decision, rebid, or withdrawn. Capture competitor, price position, customer feedback, scope gap, schedule issue, and relationship quality. Feed the loss reason and final amount back into estimating benchmarks.

## 12. Award-to-project handoff

Detect notice to proceed, award letter, subcontract, DocuSign completion, or customer confirmation. Require contract-versus-proposal comparison, approved exceptions, insurance and onboarding requirements, schedule of values, billing deadlines, submittals, project directory, contacts, job folder, project budget, estimated labor hours, foreman assignment, and kickoff. Odoo converts the opportunity into a project only after the award checklist passes.

## 13. Foreman daily report, time, and progress

The foreman sees only assigned jobs on the Odoo mobile app. Each day, the foreman records crew members, regular and overtime hours, work package, completed quantities or percent complete, photos, material usage, delays, safety issues, RFIs, extra-work notices, and next-day plan. The system compares actual hours with earned hours and estimated hours and alerts management to production variance.

## 14. Change-order detection, pricing, and approval

A field issue, customer direction, drawing revision, rejected condition, schedule impact, or extra-work photo can open a potential change event. Require written direction, date, responsible party, evidence, labor/material/equipment estimate, schedule impact, and contract notice deadline. Samuel prices the event; management approves submission; no work proceeds without authorization unless an emergency exception is documented. Approved change orders update contract value, budget, forecast, and billing.

## 15. Schedule of values, invoicing, collections, and executive control

Build the schedule of values from the awarded estimate, track billing cutoffs, percent complete, stored materials, retainage, releases, certified payroll if required, and supporting documents. Draft invoices, route approval, submit to the customer, confirm receipt, and monitor aging. Executive dashboards show lead source, pipeline, bids due, submitted value, win rate, backlog, earned revenue, labor variance, pending change orders, unbilled work, receivables, and cash-risk exceptions.

# Human approval matrix

| Decision | Primary owner | Escalation |
|---|---|---|
| Accept or decline normal lead | Samuel | CEO for strategic or high-risk lead |
| Estimate below $25,000 and above margin floor | Samuel | CEO on exception |
| Estimate $25,000-$100,000 | Samuel prepares | CEO approves |
| Estimate above $100,000 | Samuel prepares | CEO plus financial review |
| Contract terms or indemnity exception | Office / CEO | Legal or insurance review |
| Potential change event | Foreman identifies | Samuel validates |
| Change-order price | Samuel prepares | CEO approves before submission |
| Timesheet and daily report | Foreman submits | Office reviews exceptions |
| Schedule of values and invoice | Office prepares | Project/CEO approval |
| Payment, credit, write-off | Accounting | CEO approval |

# Organization for the three-user launch

## User 1 - CEO / Operations owner

Owns capacity, risk, final price thresholds, contract exceptions, cash priorities, and executive dashboard.

## User 2 - Samuel Campoverde, Senior Estimator and Revenue Operations

Owns lead command, qualification, estimate production, bid submission, follow-up, CRM hygiene, pricing of change events, and automation exception queue.

## User 3 - Office administration / accounting / project controls

Owns prequalification, onboarding, contract register, compliance documents, schedule of values, invoicing, releases, collections, and project-document control.

## Foreman pilot

The foreman is an internal paid user during the pilot and owns assigned-job daily reports, crew time, production progress, photos, issues, and next-day planning. Permissions must prevent access to company-wide pricing, payroll rates, unrelated customers, and financial reports.

## Virtual AI roles

- Intake Agent
- Qualification Agent
- Bid Coordinator
- Estimate QA Agent
- Contract Comparison Agent
- Project Controls Agent
- Billing Agent
- Executive Analyst

Each AI action records model, prompt version, source evidence, confidence, output, human reviewer, and final disposition.

# Implementation roadmap

## Phase 0 - Control design, 1-2 weeks

Finalize the data dictionary, stage definitions, job numbering, permissions, approval limits, service accounts, folder template, backup policy, KPI definitions, and integration test environment.

## Phase 1 - Revenue command center, weeks 3-6

Deploy Outlook/Yelp/website intake, deduplication, Odoo CRM, assignment, first-contact SLA, bid calendar, and executive lead dashboard. Migrate active leads only, then import historical records in batches.

## Phase 2 - Estimating integration, weeks 7-12

Connect WL PT Tool to Odoo, implement estimate package export, addenda control, estimate QA, proposal revision control, submission proof, follow-up, and outcome intelligence.

## Phase 3 - Award and field pilot, weeks 13-18

Implement award-to-project handoff, contract comparison, prequalification, submittals, project folders, schedule, one-foreman mobile pilot, daily reports, timesheets, and earned-hours reporting.

## Phase 4 - Commercial controls, weeks 19-24

Implement potential change events, change orders, schedule of values, billing cutoff controls, invoices, releases, collections, and cash-risk dashboard.

## Phase 5 - Optimization, ongoing

Tune AI prompts and model routing, add Google and Meta campaign attribution, improve production benchmarks, add customer scorecards, and expand field users only after the pilot produces reliable data.

# Required integration controls

- Dedicated Odoo integration user with minimum permissions.
- Separate development and production n8n credentials.
- Encrypted secrets; no API keys in scripts or GitHub.
- Idempotency key on every create/update workflow.
- Retry policy with exponential backoff.
- Dead-letter queue and daily exception digest.
- Versioned workflow exports in GitHub.
- Central audit log and correlation ID.
- Daily database backup and weekly restore test.
- Document retention and access rules.
- Human approval before financial or contractual commitment.
- Monitoring for stale leads, missed bid deadlines, unsubmitted daily reports, unapproved time, unpriced change events, unbilled earned work, and overdue invoices.

# Definition of success

The system is successful when every lead has an owner and next action, every bid has a deadline and outcome, every award has a complete handoff, every field day has labor and progress evidence, every extra-work event is preserved, every invoice has support and status, and management can see pipeline, backlog, labor performance, margin risk, and cash exposure without reconstructing the company from email.