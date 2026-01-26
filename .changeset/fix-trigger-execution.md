---
"@herdctl/core": minor
"herdctl": minor
---

Fix trigger command to actually execute jobs

Previously, `herdctl trigger <agent>` would create a job metadata file but never
actually run the agent. The job would stay in "pending" status forever.

Now trigger() uses JobExecutor to:
- Create the job record
- Execute the agent via Claude SDK  
- Stream output to job log
- Update job status on completion

This is a minor version bump as it adds new behavior (job execution) rather than
breaking existing APIs. The trigger() method signature is unchanged.
