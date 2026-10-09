# Security Hardening Setup Guide

This document provides step-by-step instructions for completing the security hardening of the Super Productivity repository. These steps require GitHub repository admin access and must be completed via the GitHub web UI.

## ✅ Already Completed (Automated)

- [x] **SHA Pinning**: All 55 GitHub Actions pinned to immutable commit SHAs
- [x] **CODEOWNERS**: Critical files protected with code ownership rules
- [x] **Dependabot**: Automated weekly updates for action SHAs

## 🔧 Manual Configuration Required

### 1. Enable Branch Protection (15 minutes)

**Why**: Prevents direct modification of workflow files without review, blocking unauthorized secret exfiltration.

**Steps**:

1. Navigate to: `Settings` → `Branches` → `Add branch protection rule`

2. Configure for `master` branch:

   ```
   Branch name pattern: master

   ✅ Require a pull request before merging
      ✅ Require approvals: 1
      ✅ Dismiss stale pull request approvals when new commits are pushed
      ✅ Require review from Code Owners

   ✅ Require status checks to pass before merging
      ✅ Require branches to be up to date before merging
      ✅ Status checks (select): CI Gate
         (ci.yml skips PRs that only touch docs/wiki/**, so those never
         report CI Gate and need an admin merge)

   ✅ Require conversation resolution before merging

   ✅ Include administrators
      (Forces YOU to follow the same rules - prevents accidental bypass)

   ✅ Restrict who can push to matching branches
      → Add: johannesjo
      (Only you and trusted maintainers can push)

   ⚠️ Allow force pushes: DISABLED (default)
   ⚠️ Allow deletions: DISABLED (default)
   ```

3. Click **Create** to save

**Verification**: Try to push directly to master - it should be blocked.

---

### 2. Create GitHub Environments for Production Deployments (20 minutes)

**Why**: Requires manual approval before deploying to Google Play, App Store, Docker Hub, etc. Prevents unauthorized releases.

**Steps**:

#### A. Create Environments

1. Navigate to: `Settings` → `Environments` → `New environment`

2. Create these 4 environments:
   - `production-google-play`
   - `production-apple`
   - `production-docker`
   - `production-web`

#### B. Configure Each Environment

For **production-google-play**:

1. **Protection rules**:

   ```
   ✅ Required reviewers
      → Add: johannesjo (and optional: trusted co-maintainer)

   ✅ Wait timer: 5 minutes
      (Allows time to cancel accidental deployments)

   ✅ Prevent administrators from bypassing: ENABLED
      (Even you need approval - prevents compromise via your account)
   ```

2. **Deployment branches**:

   ```
   ✅ Selected branches only
   → Add rule: master
   ```

3. **Environment secrets** (move from Repository secrets):
   - Delete from: `Settings` → `Secrets and variables` → `Actions` → Repository secrets
   - Add to: Environment → `production-google-play` → `Add secret`

   Secrets to move:
   - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

**Repeat for other environments**:

For **production-apple**:

- Secrets: `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `mac_api_key`, `mac_api_key_id`, `mac_api_key_issuer_id`, `mac_certs`, `mac_certs_password`

For **production-docker**:

- Secrets: `DOCKER_USERNAME`, `DOCKER_PASSWORD`

For **production-web**:

- Secrets: `WEB_SERVER_SSH_KEY`, `WEB_REMOTE_HOST`, `WEB_REMOTE_USER`, `WEB_REMOTE_TARGET`

#### C. Update Workflow Files (AUTOMATED - Skip this if already done)

The workflows have been updated to reference environments. Example:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest

    # Environment protection
    environment:
      name: production-google-play
      url: https://play.google.com/console/

    steps:
      - name: Deploy
        run: ...
        env:
          SECRET: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}
```

**Verification**:

1. Trigger a release workflow (e.g., create a tag)
2. Workflow should pause with "Waiting for approval" status
3. Only you (johannesjo) can approve via GitHub Actions UI

---

### 3. Enable Workflow Approval for External Contributors (5 minutes)

**Why**: Prevents fork PRs from running workflows without approval (protects secrets in PR workflows).

**Steps**:

1. Navigate to: `Settings` → `Actions` → `General`

2. Under **Fork pull request workflows**:

   ```
   ✅ Require approval for all outside collaborators
   ```

3. Click **Save**

**Verification**: Create a test fork, submit a PR - workflow should require approval.

---

### 4. Optional: Enable Signed Commits (30 minutes + training)

**Why**: Ensures all commits are from verified identities, preventing account impersonation.

**Steps**:

1. **Install Gitsign** (all maintainers):

   ```bash
   brew install sigstore/tap/gitsign

   git config --global gpg.x509.program gitsign
   git config --global commit.gpgsign true
   git config --global gpg.format x509
   git config --global gitsign.connectorID https://github.com/login/oauth
   ```

2. **Enable in Branch Protection**:
   - `Settings` → `Branches` → Edit `master` rule
   - ✅ `Require signed commits`

3. **For GitHub Actions** (workflows that commit):

   ```yaml
   jobs:
     auto-commit:
       permissions:
         id-token: write # Required for Gitsign
         contents: write

       steps:
         - uses: chainguard-dev/actions/setup-gitsign@main

         - name: Configure Git
           run: |
             git config user.name "github-actions[bot]"
             git config user.email "github-actions[bot]@users.noreply.github.com"
             git config commit.gpgsign true

         - name: Commit
           run: git commit -m "message"
   ```

**Verification**:

```bash
git commit -m "test"
# Should prompt for GitHub OIDC sign-in
# Commit shows "Verified" badge on GitHub
```

---

### 5. Optional: Review Collaborator Access (10 minutes)

**Why**: The security assessment was triggered because you granted write access to a collaborator.

**Current Risk**: Write access = Full secret access + Deployment ability

**Recommended Actions**:

1. **Audit Current Collaborators**:
   - Navigate to: `Settings` → `Collaborators and teams`
   - Review all users with "Write" or "Admin" access

2. **Consider Downgrading Access** (if appropriate):
   - Change role from "Write" to "Triage" for new/untrusted collaborators
   - Triage role allows: Manage issues/PRs, but CANNOT push code or access secrets
   - Promote to Write after 30-90 day trial period

3. **Alternative**: External Collaboration via Forks
   - Collaborators work from personal forks
   - Submit PRs for review
   - You merge after approval
   - No direct repository access

**To Change Access**:

- `Settings` → `Collaborators and teams` → Click user → `Change role` → `Triage`

---

## 📊 Security Impact Assessment

### Before Hardening

- **Risk Score**: 75/100 (HIGH - CRITICAL)
- **Vulnerabilities**:
  - ❌ Tag-based actions (supply chain attack vector)
  - ❌ No deployment approval (unauthorized releases possible)
  - ❌ No workflow protection (secret exfiltration possible)
  - ❌ Write access = full secret access

### After Automated Changes

- **Risk Score**: 55/100 (MEDIUM)
- **Mitigations**:
  - ✅ SHA-pinned actions (immune to tag poisoning)
  - ✅ CODEOWNERS (workflow changes require approval)
  - ✅ Dependabot (automated security updates)

### After Manual Configuration (Steps 1-3)

- **Risk Score**: 30/100 (LOW)
- **Additional Mitigations**:
  - ✅ Branch protection (prevents direct workflow modification)
  - ✅ Environment protection (requires approval for deployments)
  - ✅ Fork PR approval (prevents external workflow execution)

### After Optional Steps (4-5)

- **Risk Score**: 15/100 (MINIMAL)
- **Full Hardening**:
  - ✅ Signed commits (prevents impersonation)
  - ✅ Least privilege access (reduces blast radius)

---

## 🚨 Incident Response

If you suspect a security compromise:

### Immediate Actions (1 hour)

1. **Revoke ALL deployment credentials**:
   - Google Play: Google Cloud Console → Service Accounts → Disable
   - Apple: appleid.apple.com → Security → Revoke App-Specific Passwords
   - Docker Hub: hub.docker.com/settings/security → Revoke all tokens
   - SSH: Remove keys from `~/.ssh/authorized_keys` on web server

2. **Disable GitHub Actions**:
   - `Settings` → `Actions` → `General` → `Disable Actions`

3. **Remove suspicious collaborator access**:
   - `Settings` → `Collaborators` → Remove user

4. **Export audit logs**:
   ```bash
   gh api /repos/super-productivity/super-productivity/actions/runs --paginate > audit-$(date +%Y%m%d).json
   ```

### Investigation (4 hours)

5. **Review recent commits**:

   ```bash
   git log --since="7 days ago" --all --author="<suspicious-email>"
   ```

6. **Check workflow modifications**:

   ```bash
   git log -p --since="7 days ago" -- .github/workflows/
   ```

7. **Review workflow runs**:
   - Actions tab → Check for: Failed runs, unexpected executions, base64 encoding

### Recovery (24 hours)

8. **Rotate ALL credentials** (see list in main assessment document)

9. **Re-enable Actions** after confirming no malicious workflows exist

10. **Document incident** for post-mortem

---

## 📚 References

- [GitHub Actions Security Hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Using Environments for Deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [CODEOWNERS Documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [CVE-2025-30066 Analysis](https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files)

---

## ✅ Completion Checklist

Track your progress:

- [ ] Step 1: Branch protection enabled for `master`
- [ ] Step 2: Environment protection configured for all 4 environments
- [ ] Step 3: Fork PR approval enabled
- [ ] Step 4 (Optional): Signed commits enabled
- [ ] Step 5 (Optional): Collaborator access reviewed

**Estimated Total Time**: 40-60 minutes for steps 1-3

---

**Questions or Issues?**

- Review the full security assessment in the conversation history
- Check GitHub's official documentation (links above)
- Test in a private test repository first if uncertain
