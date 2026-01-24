# Privacy Policy

**Super Productivity Sync**
_Version: 08.12.2025_

_Note: This is a translation for convenience only. In case of discrepancies between the German and the English version, the German version shall prevail._

## 1. Introduction

With this Privacy Policy, we inform you about the type, scope, and purpose of the processing of personal data ("Data") within the scope of using the service **Super Productivity Sync**. This policy also explains your rights under the General Data Protection Regulation (GDPR).

## 2. Controller

**Johannes Millan**
Germany

Email: contact@super-productivity.com

_(Further legal information can be found in the Legal Notice / Impressum on the website.)_

A Data Protection Officer has not been appointed as the statutory requirements for this are not met (fewer than 20 persons constantly involved in data processing).

## 3. What Data We Process

**(1) Inventory Data**

- Email address
- Password (stored exclusively as a cryptographic hash)
- Registration date
- Account status information (e.g., Active, Inactive)

**(2) Content Data**
This includes all data you save in the "Super Productivity" app and synchronize via the Service, e.g.:

- Tasks
- Projects
- Notes
- Time tracking entries
- Settings

_Note:_ If End-to-End Encryption (E2EE) is activated, this data exists on our server exclusively in encrypted form.

**(3) Meta and Log Data**
Technically necessary when accessing the server:

- IP address
- Time of access
- App version / Browser type
- Operating system
- Error and diagnostic information

### 3a. Data Security and Encryption

**Encryption in Transit:**
All data transmissions between your app and our server use HTTPS/TLS encryption.

**Encryption at Rest:**

- **Optionally Available:** You can enable End-to-End Encryption (E2EE) in sync settings
- **When E2EE is enabled:** Your data is encrypted on your device before being sent to our server. We have no access to your encryption keys and cannot decrypt your data.
- **When E2EE is NOT enabled:** Your sync data is stored unencrypted in our database. We strongly recommend enabling E2EE for sensitive data.

**Important Notice:** Without E2EE, your data is protected only by physical and technical access controls on our server, not by encryption at rest. In case of server compromise or physical access to storage media, your data could be accessed.

**Password Security:**
Your password is never stored in plaintext. We use bcrypt hashing (12 rounds) for secure password storage.

## 4. Legal Basis for Processing

We process your data based on the following legal bases:

**(1) Performance of Contract (Art. 6(1)(b) GDPR)**
This applies in particular to:

- Storage of your account
- Synchronization of your content
- Technical provision of the Service
- Sending security-relevant system emails (e.g., password reset)

**(2) Legitimate Interest (Art. 6(1)(f) GDPR)**
Our interest is:

- Server and service security
- Detection and defense against misuse (DDoS, brute force attacks)
- Error analysis and stability improvement

**(3) Legal Obligations (Art. 6(1)(c) GDPR)**
This applies, for example, to tax retention obligations for paid plans or official requests for information.

## 5. Hosting and Infrastructure

The Service is hosted by the following provider:

**Alfahosting GmbH**
Ankerstraße 3b
06108 Halle (Saale)
Germany
Website: https://alfahosting.de/

**(1) Data Location**
Processing takes place exclusively on servers in Germany.

**(2) Data Processing Agreement**
We have concluded a Data Processing Agreement (DPA) with Alfahosting GmbH in accordance with Art. 28 GDPR. Alfahosting processes your data only according to our instructions and not for its own purposes. No transfer to a third country takes place via the hoster.

## 6. Technical and Organizational Measures (Art. 32 GDPR)

We implement the following security measures:

**Access Security:**

- HTTPS/TLS encryption for all data transmissions
- JWT-based authentication with token versioning
- bcrypt password hashing (12 rounds)
- Rate limiting and account lockout after failed login attempts
- Email verification before account activation

**Encryption:**

- **In Transit:** Full HTTPS/TLS encryption
- **At Rest:** Optionally available End-to-End Encryption (E2EE)
  - ⚠️ **IMPORTANT:** E2EE is not enabled by default
  - ⚠️ Without E2EE, data is stored unencrypted in the database
  - ✅ **Recommendation:** Enable E2EE for maximum protection

**Data Processing during Synchronization:**

**A) Standard Synchronization (without E2EE)**

- Your content data is transmitted via TLS/SSL transport encryption.
- On the server, it is stored **unencrypted** in our PostgreSQL database.
- Access by the Provider is technically possible in principle but occurs exclusively if mandatorily required for maintenance, diagnosis, or defense against technical disturbances.

**B) End-to-End Encryption (E2EE – optional)**
If you enable E2EE in the app:

- Your data is encrypted locally on your device before transmission.
- The server stores only encrypted data blocks ("Blobs").
- We have **no access** to your keys and cannot restore, decrypt, or view the data.
- Loss of the key results in permanent data loss.

**Data Minimization:**

- Minimal data collection (only required for sync functionality)
- No analytics tools or tracking
- Automatic deletion of old sync operations (45 days)

**Availability and Resilience:**

- Regular backups (you manage your own backups)
- Monitoring and error logging

**Limitations:**

- No encryption of database files at disk level
- Protection relies on hosting provider's physical security measures
- In case of server compromise, unencrypted data (without E2EE) could be accessed

## 7. Email Sending

We send exclusively transactional emails (e.g., password reset, email address confirmation, security-relevant system messages). Data processing is carried out based on Art. 6(1)(b) GDPR (Performance of Contract).

**Service Provider:**
Emails are sent technically via the mail servers of our hosting provider **Alfahosting GmbH** (see Section 5). No external email marketing providers are used. The data thus remains within the German infrastructure.

## 8. Storage Duration and Deletion

**(1) Account Deletion**
If you delete your account via the app settings, we will delete your inventory data and content data immediately, but no later than within 7 days from all active systems.

**(2) Inactivity (Free Accounts)**
We reserve the right to delete free accounts that have not been used for more than 12 months. This will only occur after prior notification to the registered email address.

**(3) Server Log Files**
Log data (IP addresses) are automatically deleted after 7 to 14 days, unless security-relevant incidents require longer storage for preservation of evidence.

**(4) Statutory Retention Obligations**
For paid accounts, we are obliged to retain invoice-relevant data (invoices, payment receipts) for up to 10 years in accordance with statutory requirements (§ 147 AO).

## 9. Transfer to Third Parties

Data is generally not transferred to third parties unless:

- You have expressly consented (Art. 6(1)(a) GDPR),
- It is necessary for the performance of the contract (e.g., transfer to payment service providers for premium accounts),
- It serves the technical provision (see Hosting),
- Or we are legally obliged to do so (e.g., to law enforcement agencies).

We **never** sell your data to third parties or advertisers.

## 10. Your Rights

Under the GDPR, you have the following rights at any time:

- **Right of Access** to your data stored by us (Art. 15 GDPR)
- **Right to Rectification** of incorrect data (Art. 16 GDPR)
- **Right to Erasure** of your data (Art. 17 GDPR)
- **Right to Restriction of Processing** (Art. 18 GDPR)
- **Right to Data Portability** (export of your data) (Art. 20 GDPR)
- **Right to Object** to processing (Art. 21 GDPR)
- **Right to Withdraw Consent** (Art. 7(3) GDPR)

**Right to Lodge a Complaint:**
You have the right to lodge a complaint with a data protection supervisory authority. The authority responsible for us is:

**The Saxon Data Protection Commissioner (Sächsischer Datenschutzbeauftragter)**
Website: https://www.saechsdsb.de/

To exercise your rights (e.g., deletion), a simple email is sufficient:
📧 contact@super-productivity.com

## 11. Contact

If you have any questions about data protection, please contact us at:
Email: contact@super-productivity.com
Or by mail at the address provided in Section 2.
