/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10000;

// Enable JSON body parsing with reasonable size limits
app.use(express.json({ limit: '10mb' }));

// CORS headers configuration to support decoupled hosts like Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
  } else {
    next();
  }
});

// Helper to base64 encode for Azure DevOps Basic Auth
const base64Encode = (str: string): string => {
  return Buffer.from(str).toString('base64');
};

/**
 * Endpoint: GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: process.env.NODE_ENV || 'production', message: 'SprintSync Standalone Backend is active.' });
});

/**
 * Endpoint: POST /api/validateAzureSettings
 */
app.post('/api/validateAzureSettings', (req, res) => {
  const { orgName, projectName, areaPath, iterationPath } = req.body;
  const errors: string[] = [];

  if (!orgName || !orgName.trim()) {
    errors.push('Organization Name is required.');
  }
  if (!projectName || !projectName.trim()) {
    errors.push('Project Name is required.');
  }
  if (!areaPath || !areaPath.trim()) {
    errors.push('Area Path is required.');
  }
  if (!iterationPath || !iterationPath.trim()) {
    errors.push('Iteration Path is required.');
  }

  if (errors.length > 0) {
    res.status(400).json({ valid: false, errors });
  } else {
    res.json({ valid: true });
  }
});

/**
 * Endpoint: POST /api/testConnection
 */
app.post('/api/testConnection', async (req, res) => {
  const { orgName, projectName, personalAccessToken } = req.body;

  const pat =
    personalAccessToken ||
    process.env.AZURE_DEVOPS_PAT;

  if (!orgName || !projectName) {
    return res.status(400).json({
      success: false,
      error: 'orgName and projectName are required.',
    });
  }

  if (!pat) {
    return res.json({
      success: true,
      simulated: true,
      message:
        'PAT not supplied. Running in simulation mode.',
    });
  }

  try {
    const b64Token = Buffer
      .from(`:${pat}`)
      .toString('base64');

    const url =
      `https://dev.azure.com/${encodeURIComponent(orgName)}/_apis/projects?api-version=7.1`;

    console.log('========================');
    console.log('TEST CONNECTION');
    console.log('URL:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${b64Token}`,
        Accept: 'application/json',
      },
    });

    const contentType =
      response.headers.get('content-type') || '';

    const body = await response.text();

    console.log('STATUS:', response.status);
    console.log('CONTENT TYPE:', contentType);
    console.log(
      'BODY:',
      body.substring(0, 500)
    );

    if (!contentType.includes('application/json')) {
      return res.status(500).json({
        success: false,
        error:
          'Azure DevOps returned a non-JSON response.',
        status: response.status,
        contentType,
        responseSnippet:
          body.substring(0, 500),
      });
    }

    const data = JSON.parse(body);

    const projects = data.value || [];

    const matchedProject =
      projects.find(
        (p: any) =>
          p.name.toLowerCase() ===
          projectName.toLowerCase()
      );

    if (!matchedProject) {
      return res.status(404).json({
        success: false,
        error: `Project '${projectName}' not found in organization '${orgName}'.`,
      });
    }

    return res.json({
      success: true,
      projectName: matchedProject.name,
      projectId: matchedProject.id,
      message:
        'Azure DevOps connection successful.',
    });

  } catch (err: any) {
    console.error(
      '[testConnection]',
      err
    );

    return res.status(500).json({
      success: false,
      error:
        err.message ||
        'Unknown server error.',
    });
  }
});
/**
 * Endpoint: POST /api/createStories
 */
app.post('/api/createStories', async (req, res) => {
  const { orgName, projectName, areaPath, iterationPath, stories, enableSubTasks, personalAccessToken } = req.body;
  const pat = personalAccessToken || process.env.AZURE_DEVOPS_PAT;

  if (!orgName || !projectName || !stories || !Array.isArray(stories)) {
    res.status(400).json({ success: false, error: 'Missing or invalid parameters in payload.' });
    return;
  }

  console.log(`[createStories] Commencing bulk creation pipeline for ${stories.length} stories...`);

  // If PAT is missing, run in sandbox simulated mode
  if (!pat) {
    console.log(`[createStories] Simulated Mode: Creating ${stories.length} stories (Subtasks: ${!!enableSubTasks}).`);
    const created: any[] = [];
    const failures: any[] = [];

    const defaultWorkItemType = req.body?.defaultWorkItemType || 'User Story';

    for (const story of stories) {
      let isFailure = false;
      let error = '';
      let resolution = '';

      // 1. Every story must carry its own work item type. Do not inherit or default to Feature. Explicitly set inside loop.
      const selectedWorkType = story.workType || defaultWorkItemType || 'User Story';
      let workItemType = 'User Story';
      const wt = String(selectedWorkType).toLowerCase();
      if (wt.includes('user story') || wt.includes('userstory') || wt === 'story' || wt === 'user_story') {
        workItemType = 'User Story';
      } else if (wt.includes('task') || wt === 'task') {
        workItemType = 'Task';
      } else if (wt.includes('bug') || wt === 'bug') {
        workItemType = 'Bug';
      } else if (wt.includes('feature') || wt === 'feature') {
        workItemType = 'Feature';
      } else if (wt.includes('epic') || wt === 'epic') {
        workItemType = 'Epic';
      } else {
        workItemType = 'User Story';
      }

      if (story.title.toLowerCase().includes('dcn')) {
        isFailure = true;
        error = 'Feature 2174321 not found';
        resolution = 'Verify Feature ID in Review tab';
      } else if (story.title.toLowerCase().includes('fail') || (story.id && story.id.includes('fail'))) {
        isFailure = true;
        error = 'Azure Work Item link error: Associated portfolio Epic level authorization token invalid';
        resolution = 'Verify parent epic and credentials';
      } else if (Math.random() < 0.05) { // 5% random sandbox failure for realism
        isFailure = true;
        error = 'Feature 2185203 not found';
        resolution = 'Check if Feature ID has been closed as duplicate in ADO';
      }

      if (isFailure) {
        failures.push({
          id: story.id,
          title: story.title,
          error,
          resolution,
          story: { ...story, workType: workItemType },
        });
      } else {
        const mockAdoId = 2810000 + Math.floor(Math.random() * 50000);
        const createdType = workItemType; // In simulation, verify matches

        // Verify DevOps response type
        if (createdType.toLowerCase() !== workItemType.toLowerCase()) {
          failures.push({
            id: story.id,
            title: story.title,
            error: `Validation Error: Created work item type "${createdType}" differs from requested type "${workItemType}".`,
            resolution: 'Verify parent epic and credentials',
            story: { ...story, workType: workItemType },
          });
          continue;
        }

        // Add debug logging
        console.log(`[SprintSync Debug Log]
Story Title: ${story.title}
Requested Work Item Type: ${workItemType}
Created Work Item Type: ${createdType}
Created Work Item ID: ${mockAdoId}`);

        created.push({
          id: mockAdoId,
          title: story.title,
          url: `https://dev.azure.com/${orgName}/${projectName}/_workitems/edit/${mockAdoId}`,
          story: { ...story, workType: createdType },
        });

        // Auto child creation if enabled
        if (enableSubTasks && createdType === 'User Story') {
          const taskTypes = ['Functional Validation Task', 'Automation Task', 'Regression Task'];
          taskTypes.forEach((taskType, tkIdx) => {
            const childId = mockAdoId + tkIdx + 1;
            created.push({
              id: childId,
              title: `${taskType} - ${story.title}`,
              url: `https://dev.azure.com/${orgName}/${projectName}/_workitems/edit/${childId}`,
              story: {
                ...story,
                id: `MOCK-SUB-${childId}`,
                title: `${taskType} - ${story.title}`,
                workType: 'Task',
                points: 0.5,
              },
            });
          });
        }
      }
    }

    res.json({
      success: true,
      simulated: true,
      created,
      failures,
    });
    return;
  }

  // Live DevOps Integration Mode
  const created: any[] = [];
  const failures: any[] = [];
  const b64Token = base64Encode(`:${pat}`);
  const defaultWorkItemType = req.body?.defaultWorkItemType || 'User Story';

  for (const story of stories) {
    try {
      // 1. Every story must carry its own work item type. Do not inherit or default to Feature. Explicitly set inside loop.
      const selectedWorkType = story.workType || defaultWorkItemType || 'User Story';
      let workItemType = 'User Story';
      const wt = String(selectedWorkType).toLowerCase();
      if (wt.includes('user story') || wt.includes('userstory') || wt === 'story' || wt === 'user_story') {
        workItemType = 'User Story';
      } else if (wt.includes('task') || wt === 'task') {
        workItemType = 'Task';
      } else if (wt.includes('bug') || wt === 'bug') {
        workItemType = 'Bug';
      } else if (wt.includes('feature') || wt === 'feature') {
        workItemType = 'Feature';
      } else if (wt.includes('epic') || wt === 'epic') {
        workItemType = 'Epic';
      } else {
        workItemType = 'User Story';
      }

      const encodedType = encodeURIComponent(workItemType);
      const url = `https://dev.azure.com/${encodeURIComponent(orgName)}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$${encodedType}?api-version=7.1-preview.3`;

      // Construct JSON Patch Operations payload
      const patchOps = [
        { op: 'add', path: '/fields/System.Title', value: story.title },
        { op: 'add', path: '/fields/System.AreaPath', value: areaPath },
        { op: 'add', path: '/fields/System.IterationPath', value: iterationPath },
      ];

      // Add AssignedTo if e-mail is present
      if (story.email && story.email.trim()) {
        patchOps.push({ op: 'add', path: '/fields/System.AssignedTo', value: story.email.trim() });
      }

      // Add Story Points/Value if defined and greater than zero
      if (story.points && story.points > 0) {
        if (workItemType === 'User Story' || workItemType === 'Feature') {
          patchOps.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: Number(story.points) });
        } else if (workItemType === 'Task') {
          patchOps.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: Number(story.points) });
        }
      }

      // Add standard description containing Confluence domain context
      const descriptionHtml = `<div><strong>SprintSync Planning Note:</strong><br/>
Domain: ${story.domain || 'Unspecified'}<br/>
Activity: ${story.activity || 'Unassigned'}<br/>
Feature Mapping ID: ${story.featureId || 'None'}<br/>
Epic Link ID: ${story.epicId || 'None'}</div>`;

      patchOps.push({ op: 'add', path: '/fields/System.Description', value: descriptionHtml });

      // Execute POST request to Azure DevOps
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${b64Token}`,
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patchOps),
      });

      if (response.ok) {
        const data: any = await response.json();
        const parentId = data.id;
        const returnedType = data.fields?.['System.WorkItemType'] || workItemType;

        // Verify DevOps response type
        if (returnedType.toLowerCase() !== workItemType.toLowerCase()) {
          const errMsg = `Validation Error: Created work item type "${returnedType}" differs from requested type "${workItemType}".`;
          failures.push({
            id: story.id,
            title: story.title,
            error: errMsg,
            resolution: 'Verify target DevOps process template permissions and scopes.',
            story: { ...story, workType: workItemType },
          });
          continue;
        }

        // Debug logging
        console.log(`[SprintSync Debug Log]
Story Title: ${story.title}
Requested Work Item Type: ${workItemType}
Created Work Item Type: ${returnedType}
Created Work Item ID: ${parentId}`);

        created.push({
          id: parentId,
          title: story.title,
          url: `https://dev.azure.com/${orgName}/${projectName}/_workitems/edit/${parentId}`,
          story: { ...story, workType: returnedType },
        });

        // Trigger sub-tasks bulk insertion if enabled
        if (enableSubTasks && workItemType === 'User Story') {
          const taskTypes = ['Functional Validation Task', 'Automation Task', 'Regression Task'];
          for (const taskType of taskTypes) {
            try {
              const childUrl = `https://dev.azure.com/${encodeURIComponent(orgName)}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$Task?api-version=7.1-preview.3`;
              const childPatchOps = [
                { op: 'add', path: '/fields/System.Title', value: `${taskType} - ${story.title}` },
                { op: 'add', path: '/fields/System.AreaPath', value: areaPath },
                { op: 'add', path: '/fields/System.IterationPath', value: iterationPath },
                { op: 'add', path: '/fields/System.Description', value: `<div>Child task automatic creation triggered by SprintSync bulk mapping context.</div>` },
              ];
              if (story.email && story.email.trim()) {
                childPatchOps.push({ op: 'add', path: '/fields/System.AssignedTo', value: story.email.trim() });
              }
              // Link as child of newly created User Story
              childPatchOps.push({
                op: 'add',
                path: '/relations/-',
                value: {
                  rel: 'System.LinkTypes.Hierarchy-Reverse',
                  url: `https://dev.azure.com/${encodeURIComponent(orgName)}/_apis/wit/workitems/${parentId}`,
                  attributes: {
                    comment: 'SprintSync parent story linkage'
                  }
                }
              });

              const childRes = await fetch(childUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${b64Token}`,
                  'Content-Type': 'application/json-patch+json',
                },
                body: JSON.stringify(childPatchOps),
              });

              if (childRes.ok) {
                const childData: any = await childRes.json();
                created.push({
                  id: childData.id,
                  title: `${taskType} - ${story.title}`,
                  url: `https://dev.azure.com/${orgName}/${projectName}/_workitems/edit/${childData.id}`,
                  story: {
                    ...story,
                    id: `LIVE-SUB-${childData.id}`,
                    title: `${taskType} - ${story.title}`,
                    workType: 'Task',
                    points: 0.5,
                  },
                });
              }
            } catch (childErr) {
              console.error(`[subtasks] failed to append taskType ${taskType} for parent ID ${parentId}:`, childErr);
            }
          }
        }
      } else {
        const errorText = await response.text();
        failures.push({
          id: story.id,
          title: story.title,
          error: `DevOps API status ${response.status}: ${errorText}`,
          resolution: 'Verify PAT scopes configuration in environment keys',
          story: { ...story, workType: workItemType },
        });
      }
    } catch (e: any) {
      const selectedWorkType = story.workType || defaultWorkItemType || 'User Story';
      failures.push({
        id: story.id,
        title: story.title,
        error: e.message || 'Network exception during ADO bulk transaction',
        resolution: 'Check endpoint connection routes',
        story: { ...story, workType: selectedWorkType },
      });
    }
  }

  res.json({
    success: true,
    simulated: false,
    created,
    failures,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Standalone SprintSync Backend running on port ${PORT}`);
});
