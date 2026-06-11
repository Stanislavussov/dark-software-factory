# Dark Software Factory: Relevant Concept Notes

This note filters the broader Dark Software Factory concept down to what is useful for the current repository.

The repo is currently in the **VPS Foundation** phase: one repeatable Ubuntu host that can run the first factory services. It is not yet implementing multi-agent orchestration, digital twins, fleet management, or autonomous deployment loops.

## Related to This Repo

### Core Definition

A Dark Software Factory is an automated software delivery system where agents perform implementation, validation, and deployment work while humans define intent, policies, and audit outcomes.

This matches the language in `CONTEXT.md` and the README:

- humans define product intent, architectural policies, security policies, and approval boundaries;
- agents and automation eventually handle task decomposition, code changes, verification, remediation, and deployment;
- the system needs repeatable infrastructure before higher-level agent workflows can be useful.

### Human Role

The relevant human role for this repo is not "manual coder for every change". It is closer to:

- intent author;
- policy owner;
- architecture reviewer;
- release approver;
- audit reader.

This supports the repo's focus on durable context, task records, and repeatable bootstrap scripts.

### Required Factory Foundations

The concept says a factory needs more than prompts. The parts that matter now are:

- persistent project context and vocabulary;
- task records and decision history;
- agent-readable operating instructions;
- deterministic verification gates;
- isolated execution environments;
- deployment infrastructure;
- audit trails for what changed and why.

The current repo already starts this with:

- `CONTEXT.md` for vocabulary;
- `README.md` for the project-level concept;
- `docs/tasks/0001-vps-foundation.md` for task history and acceptance criteria;
- `ansible/` for the first repeatable deployment environment.

### Codified Knowledge

The concept's most relevant near-term point is that agentic systems need machine-readable project knowledge. That maps directly to keeping project decisions in version-controlled markdown instead of relying on memory or chat history.

Useful documentation types for this repo:

- domain vocabulary in `CONTEXT.md`;
- task records in `docs/tasks/`;
- architecture decision records once architectural choices start accumulating;
- runbooks for provisioning, validation, deployment, and recovery;
- explicit policies for security, secrets, approvals, and rollback.

### VPS Foundation

The VPS Foundation is the first concrete step because the factory needs a production-capable place to run workloads before orchestration exists.

The relevant infrastructure capabilities are:

- SSH hardening;
- firewall defaults;
- fail2ban;
- Docker Engine and Docker Compose;
- Docker log rotation;
- deploy user;
- app root;
- optional swap for small hosts;
- optional nginx and certbot public routing.

This is exactly the scope of `docs/tasks/0001-vps-foundation.md` and `ansible/README.md`.

### Verification Direction

The concept's verification-heavy framing is relevant, but only as direction for future tasks. Current verification is intentionally small:

- local Ansible syntax validation;
- check mode before provisioning;
- successful provisioning recap;
- manual confirmation that SSH, Docker, firewall, and deploy-user behavior match the acceptance criteria.

Later factory services should add stronger gates such as tests, static checks, integration checks, deployment checks, and audit logs.

### Git-Based Ratchet

The idea of a Git-based ratchet is relevant as a future operating model:

- make changes in isolated branches;
- verify before merge or deployment;
- only promote changes that pass gates;
- keep task history tied to commits and outcomes.

For the current repo, this means task docs and infrastructure changes should stay small, reviewable, and tied to explicit acceptance criteria.

## Later, Not Current Scope

These parts of the broader concept are useful background, but they are not related to the current docs except as future possibilities:

- Software 1.0 / 2.0 / 3.0 evolution framing;
- five-level autonomy model;
- Agent-as-a-Service terminology;
- named external platforms such as Honk, Fabro, AgentForge, Human CLI, Memo, and Backstage;
- SPOQ task scheduling and multi-agent hierarchy;
- quality thresholds such as 95 percent validation scoring;
- digital twin universes for third-party services;
- hidden holdout scenarios;
- autonomous self-healing loops;
- token-budget economics;
- fleet management across thousands of repositories;
- gene transfusion and regenerative software cells;
- differential monitoring against live third-party APIs.

These should not drive the current Ansible foundation work. They can become relevant only after the repo has concrete factory services, deployment workflows, and verification harnesses.

## Near-Term Documentation Path

The next useful docs are:

- an ADR template for infrastructure and architecture decisions;
- a task for the first concrete factory service;
- a runbook for operating the VPS Foundation after provisioning;
- a security policy covering SSH access, deploy keys, secrets, firewall rules, and public routing;
- a verification policy that defines what must pass before a factory service is deployed.
