# Distributor pre-order review — 2026-10-06

Latest local HTTP checks supersede earlier account-access results in ORDER_CHECK.md.

- Both Demo Pune Distribution and Demo Mumbai Distribution login return HTTP 403: Your distributor account is inactive. Contact the Company to reactivate it.
- /requests returns HTTP 404. Source confirms there is no Requests route or sidebar entry, although RequestsScreen and its acceptance/approval controls still exist.
- Source search found no frontend callers for /api/network/initiate or /api/agreements/create. The Company-side UI does not complete relationship setup either.
- Earlier authenticated Pune checks showed zero networks and agreements. Their current contents could not be rechecked because login is now blocked.

Required sequence:

1. Company activates Distributor organization; Distributor signs in with a fresh session.
2. Company OWNER/ADMIN initiates network connection to Distributor owner email.
3. Distributor OWNER/ADMIN accepts connection.
4. Company OWNER drafts agreement with explicit shares totaling 100 and machine charges.
5. Distributor OWNER approves agreement.
6. Distributor OWNER/ADMIN requests 1–50 kiosks; order begins UNDER_REVIEW and PENDING payment.

Backend handlers implement these stages with access gates. Frontend relationship creation and the disconnected Requests page prevent completion entirely through the current UI. Registration alone does not create network/agreement records.

No organization status was changed, agreement accepted, or order placed in this review. This is HTTP and source verification, not a browser interaction test. A broad earlier check stalled and was interrupted; only the completed checks above are claimed.
