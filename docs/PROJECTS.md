# Project Topics and delivery

Under a visible idea in a Community Topic, an administrator can create a
Project Topic. The new Topic stores the original post ID and optional HTTPS
GitHub repository URL. The source post remains in its original Topic.

A task can start as a participant's proposal or as open work created by an
administrator. The assignee claims it and submits a public HTTPS link. A
different person reviews the submission. An administrator records acceptance
or requests changes. The assignee can revise and resubmit, preserving previous
artifact versions. Cancelled or completed tasks can be reopened by an admin.

```text
proposed → open → claimed → submitted → in_review → done
                                         ↓
                                 changes_requested
                                         ↓
                                  claimed/submitted
```

| Endpoint                             | Purpose                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `POST /api/admin/posts/:id/promote`  | Create a Project Topic from a visible idea                                     |
| `GET /api/projects/:id/tasks`        | Public list for an active Project Topic                                        |
| `GET /api/tasks/:id`                 | Task and a page of artifacts                                                   |
| `POST /api/projects/:id/tasks`       | Propose a task                                                                 |
| `POST /api/admin/projects/:id/tasks` | Create an open task                                                            |
| `POST /api/tasks/:id/claim`          | Claim open work or reclaim assigned work with changes requested                |
| `POST /api/tasks/:id/artifacts`      | Submit one artifact link as the current assignee                               |
| `POST /api/tasks/:id/review`         | Record independent review with the current task `version`                      |
| `POST /api/admin/tasks/:id/review`   | Approve, accept, request changes, cancel, or reopen with the current `version` |
| `PATCH /api/admin/tasks/:id`         | Edit task metadata with the current `version`                                  |

POST mutations use an `Idempotency-Key`. Competing claims can only set one
assignee. A second claim returns a conflict. A version mismatch on a review,
decision, or edit returns `TASK_VERSION_CONFLICT` so the client can refresh.

Artifacts support `pr`, `document`, `research`, `commit`, `preview`, and `other`.
URLs omit query strings, fragments and embedded credentials. A `pr` must use the
GitHub pull request path. The application stores the link and manually recorded
review only. GitHub remains responsible for repository authorization, branch
changes, checks, and merge decisions. See [MCP tools](MCP.md) for Agent access.
