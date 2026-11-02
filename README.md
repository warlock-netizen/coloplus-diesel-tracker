# ColoPlus Smart Diesel & Autonomy Tracking System ⛽📊

An end-to-end operational fuel management and predictive run-out tracking dashboard built for **ColoPlus Telecom Infrastructure**, monitoring **76 nationwide telecommunications tower sites**.

---

## 🚀 Key Features

* **Daily Diesel Consumption Monitoring:**
  * Tracks **CPD (Consumption Per Day in Litres)** and **CPH (Consumption Per Hour in Litres)**.
  * Real-time financial daily burn rate calculated in Nigerian Naira (₦).
* **Current Diesel Levels & Tank Gauge:**
  * Dynamic visual tank progress bars with fill percentage.
  * Multi-tier alert badges:
    * 🚨 **Critical:** $\le 200\text{L}$ or $\le 3\text{ days}$ autonomy remaining (Needs immediate refuel).
    * ⚠️ **Warning:** $201\text{L} - 400\text{L}$ or $3 - 6\text{ days}$ autonomy remaining (Reorder point reached).
    * 🟢 **Healthy:** $> 400\text{L}$ or $> 6\text{ days}$ safe autonomy.
* **Diesel Bought & Delivery Tracking:**
  * Records latest fuel delivery batches (quantity in Litres, supply date, and vendor/supplier name).
  * Built-in fuel logger & simulator to test delivery batches (`+200L`, `+500L`, `+1,000L`, or custom batch size) and calculate immediate dry-date extensions.
* **Time-to-Empty (TTE) & Run-Out Predictions:**
  * Days and hours of autonomy remaining:
    $$\text{Autonomy Days} = \frac{\text{Current Tank Level (L)}}{\text{CPD (L/day)}}$$
  * Exact predicted date and timestamp when each site will run dry.
  * 200L Emergency Reorder Point (ROP) threshold countdown to prevent generator shutdowns.
* **Personnel in Charge & Instant Contact Dispatch:**
  * Name and contact number for assigned **Field Support Engineers (FSE)**.
  * Direct 1-click **Call** (`tel:`) and **WhatsApp** (`wa.me`) shortcuts.
  * On-site security guard (CLO) names and contacts.
  * **📋 Copy Alert Dispatch:** 1-click generation and copying of ready-to-send SMS/WhatsApp emergency dispatch tickets.
* **Reporting & Auditing:**
  * One-click CSV export of nationwide fuel status.
  * Print-ready dispatch roster.

---

## 🛠️ Project Structure

```text
coloplus-diesel-tracker/
├── index.html               # Single-page interactive application & dashboard
├── data/
│   └── sites_data.json      # Structured audit database of 76 operational sites
├── .gitignore               # Git ignore rules
└── README.md                # Project documentation
```

---

## 💻 How to Run Locally

Simply double-click `index.html` or open it with any web browser (Chrome, Edge, Firefox, Safari). No external backend or database server is required—the dashboard is entirely self-contained and responsive.

---

## 🌐 Deploy to GitHub Pages (1-Click Live Web Link)

1. Go to repository **Settings** on GitHub.
2. Select **Pages** from the left sidebar.
3. Under **Branch**, select `main` and `/ (root)`, then click **Save**.
4. Within 1-2 minutes, GitHub will publish a live web URL for your dashboard!

---

## 📄 License

Proprietary internal operations asset for **ColoPlus Telecom Infrastructure**. All rights reserved.
