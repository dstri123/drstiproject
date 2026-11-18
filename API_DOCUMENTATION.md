# 📚 RBAC Distribution API Documentation

## Overview
Complete REST API for Role-Based Access Control with Project & Data Management

**Base URL:** `http://localhost:8000/api/v1/`  
**Swagger Docs:** `http://localhost:8000/api/docs/`  
**Schema:** `http://localhost:8000/api/schema/`

---

## 🔐 Authentication Endpoints

### Sign Up
```
POST /auth/signup/
Content-Type: application/json

{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "securepass123"
}

Response: 201 Created
{
  "id": 1,
  "username": "john_doe",
  "email": "john@example.com",
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

### Login
```
POST /auth/login/
Content-Type: application/json

{
  "username": "john_doe",
  "password": "securepass123"
}

Response: 200 OK
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "user": {
    "id": 1,
    "username": "john_doe",
    "email": "john@example.com",
    "role": "admin"
  }
}
```

### Get Profile
```
GET /profile/
Authorization: Bearer {access_token}

Response: 200 OK
{
  "id": 1,
  "username": "john_doe",
  "email": "john@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "role": "admin",
  "bio": "Project administrator"
}
```

### Update Profile
```
PUT /profile/update/
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Doe",
  "bio": "Updated bio",
  "password": "newpassword123"
}

Response: 200 OK
{
  "success": true,
  "message": "Profile updated successfully"
}
```

---

## 📊 Project Endpoints

### List All Projects
```
GET /projects/
Authorization: Bearer {access_token}

Response: 200 OK
[
  {
    "id": 1,
    "slug": "project-abc",
    "project_name": "ABC Project",
    "description": "Project description",
    "start": "2026-06-13",
    "end": "2026-07-03",
    "image": "http://localhost:8000/media/projects/image.jpg",
    "users": [1, 2, 3],
    "latitude": "40.712776",
    "longitude": "-74.005974"
  }
]
```

### Create Project
```
POST /projects/
Authorization: Bearer {access_token}
Content-Type: multipart/form-data

{
  "project_name": "ABC Project",
  "description": "Project description",
  "start": "2026-06-13",
  "end": "2026-07-03",
  "image": <file>,
  "latitude": "40.712776",
  "longitude": "-74.005974"
}

Response: 201 Created
{
  "id": 1,
  "slug": "abc-project",
  "project_name": "ABC Project",
  ...
}
```

### Get Project Details
```
GET /projects/{id}/
Authorization: Bearer {access_token}

Response: 200 OK
{
  "id": 1,
  "slug": "abc-project",
  "project_name": "ABC Project",
  "description": "Project description",
  "image": "http://localhost:8000/media/projects/image.jpg",
  "users": [
    {
      "id": 1,
      "username": "john_doe",
      "email": "john@example.com",
      "role": "admin"
    }
  ]
}
```

### Update Project
```
PUT /projects/{id}/
Authorization: Bearer {access_token}
Content-Type: multipart/form-data

{
  "project_name": "Updated Name",
  "description": "Updated description",
  "image": <file>
}

Response: 200 OK
```

### Delete Project
```
DELETE /projects/{id}/delete/
Authorization: Bearer {access_token}

Response: 204 No Content
```

---

## 📁 BIM Data Endpoints

### List BIM Files
```
GET /projects/{project_id}/bim/
Authorization: Bearer {access_token}

Response: 200 OK
[
  {
    "id": 1,
    "project": 1,
    "description": "BIM Model v1",
    "file": "http://localhost:8000/media/bim/model.rvt",
    "date": "2026-06-13",
    "is_latest": true,
    "created_at": "2026-06-13T10:30:00Z"
  }
]
```

### Upload BIM File
```
POST /projects/{project_id}/bim/
Authorization: Bearer {access_token}
Content-Type: multipart/form-data

{
  "description": "BIM Model v1",
  "file": <file.rvt | file.ifc | file.dwg>,
  "date": "2026-06-13",
  "is_latest": true
}

Response: 201 Created
{
  "id": 1,
  "description": "BIM Model v1",
  "file": "http://localhost:8000/media/bim/model.rvt",
  "is_latest": true
}
```

### Update BIM File
```
PUT /bim/{id}/update/
Authorization: Bearer {access_token}
Content-Type: multipart/form-data

{
  "description": "Updated description",
  "is_latest": true
}

Response: 200 OK
```

### Delete BIM File
```
DELETE /bim/{id}/delete/
Authorization: Bearer {access_token}

Response: 204 No Content
```

**Supported BIM Formats:** `.rvt`, `.ifc`, `.dwg`, `.nwd`, `.nwc`, `.fbx`

---

## ☁️ Point Cloud Data Endpoints

### List Point Cloud Files
```
GET /projects/{project_id}/pointcloud/
Authorization: Bearer {access_token}

Response: 200 OK
[
  {
    "id": 1,
    "project": 1,
    "description": "Point Cloud v1",
    "file": "http://localhost:8000/media/pointcloud/model.las",
    "date": "2026-06-13",
    "is_latest": true
  }
]
```

### Upload Point Cloud File
```
POST /projects/{project_id}/pointcloud/
Authorization: Bearer {access_token}
Content-Type: multipart/form-data

{
  "description": "Point Cloud v1",
  "file": <file.e57 | file.las | file.laz>,
  "date": "2026-06-13",
  "is_latest": true
}

Response: 201 Created
```

### Update Point Cloud File
```
PUT /pointcloud/{id}/update/
Authorization: Bearer {access_token}
Content-Type: multipart/form-data

{
  "description": "Updated description",
  "is_latest": true
}

Response: 200 OK
```

### Delete Point Cloud File
```
DELETE /pointcloud/{id}/delete/
Authorization: Bearer {access_token}

Response: 204 No Content
```

**Supported Formats:** `.e57`, `.las`, `.laz`, `.pts`, `.xyz`, `.ply`

### Preview a Monthly Merge
Lists the point clouds of one project/month that a merge would use, plus the
latest merge for that month and whether it is out of date.
```
GET /pointcloud/merge/?project_id=7&year=2026&month=11
Authorization: Bearer {access_token}

Response: 200 OK
{
  "project_name": "Project A",
  "month_label": "November 2026",
  "output_name": "November_2026_Merged_PointCloud.ply",
  "sources": [{"id": 50, "date": "2026-11-05", "name": "scan_01.las", "format": "LAS", "has_saved_alignment": false}],
  "excluded_sources": [],      // unreadable formats (E57, PLZ), left out
  "missing_sources": [],       // files missing from storage — block merging
  "eligible_count": 3,
  "can_merge": true,           // false for read-only viewer accounts
  "running": null,             // queued/running merge, if any
  "latest": {...},             // most recent merge (any status)
  "latest_completed": {..., "is_stale": false}
}
```

### Start a Monthly Merge
Merges every readable point cloud of the project dated in that month into one
registered, voxel-downsampled PLY, in the background. Original files and their
saved transforms are never modified; the result is not a per-date upload.
```
POST /pointcloud/merge/
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "project_id": 7,
  "year": 2026,
  "month": 11,
  "force": false,        // true = regenerate even if an up-to-date result exists
  "voxel_size": null     // optional override, in point-cloud units
}

Response: 202 Accepted   {"merge": {"id": 12, "status": "queued", ...}}
Response: 200 OK         {"merge": {...}, "already_running": true}   // no duplicate job
Response: 200 OK         {"merge": {...}, "reused": true}            // sources unchanged
Response: 400            {"error": "...", "failed_sources": [...]}  // empty month / missing files
Response: 403            not assigned to the project, or a viewer account
```

### Merge Status / Result
```
GET /pointcloud/merge/{id}/
Authorization: Bearer {access_token}

Response: 200 OK
{
  "id": 12, "merged_file_id": 12, "status": "completed",   // queued|running|completed|failed
  "progress": 1.0, "stage_label": "Completed",
  "source_ids": [50, 51, 52], "total_source_files": 3,
  "file_url": "http://localhost:8000/media/merged_pointclouds/project_7/November_2026_Merged_PointCloud.ply",
  "point_count": 5139891, "input_point_count": 9243735, "voxel_size": 0.0063,
  "coordinate_frame": "source",          // or "viewer_world" when sources had saved alignments
  "transform": null,                     // viewer placement for viewer_world results
  "origin_offset": [x, y, z],            // frame coordinates of the PLY's (0,0,0)
  "registration": [{"id": 51, "method": "common_coordinates_adjoining", "fitness": 0.75, "rmse": 0.03, ...}],
  "min_fitness": 0.75, "max_rmse": 0.03,
  "error_message": "", "failed_sources": [],
  "is_stale": false                      // true once the month's sources changed
}
```

### Export Cropped Point Cloud (viewer "Export PLY")
Crops the **original upload** (full density, double-precision xyz) to the
viewer's section box and returns a binary PLY. Supported sources: PLY, LAS,
LAZ, PTS, XYZ, and completed monthly merges.
```
POST /processing/tools/pointcloud-export/
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "pointcloud_id": 50,                   // or "merge_id": 12 (exactly one)
  "raw_to_world": [16 numbers],          // Three.js Matrix4.elements (column-major):
                                         // raw file coords -> viewer world
  "box": {"min": [x, y, z], "max": [x, y, z]},   // viewer world; null = whole cloud
  "frame": "original"                    // "original" = scan coordinates (merges: + origin_offset)
                                         // "aligned"  = viewer placement, converted to Z-up
}

Response: 200 OK  (application/octet-stream, attachment)
  Content-Disposition: attachment; filename="scan_cropped_original.ply"
  X-Point-Count: 1234567
Response: 400  bad payload, unsupported format, or no points inside the box
Response: 403  not assigned to the project
Response: 404  point cloud / completed merge not found
```

---

## 🖼️ Image Endpoints

### List Project Images
```
GET /projects/{project_id}/images/
Authorization: Bearer {access_token}

Response: 200 OK
[
  {
    "id": 1,
    "project": 1,
    "batch_name": "Site Photos",
    "original_name": "photo_001.jpg",
    "image": "http://localhost:8000/media/images/photo_001.jpg",
    "date": "2026-06-13"
  }
]
```

### Upload Images (ZIP)
```
POST /projects/{project_id}/images/
Authorization: Bearer {access_token}
Content-Type: multipart/form-data

{
  "zip_file": <archive.zip>,
  "date": "2026-06-13"
}

Response: 201 Created
[
  {
    "id": 1,
    "batch_name": "archive",
    "original_name": "photo_001.jpg",
    "image": "http://localhost:8000/media/images/photo_001.jpg"
  }
]
```

### Delete Image
```
DELETE /images/{id}/delete/
Authorization: Bearer {access_token}

Response: 204 No Content
```

---

## 👥 User Management Endpoints

### List All Users
```
GET /users/
Authorization: Bearer {access_token}

Response: 200 OK
[
  {
    "id": 1,
    "username": "john_doe",
    "email": "john@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "admin"
  }
]
```

### Get User Details
```
GET /users/{id}/
Authorization: Bearer {access_token}

Response: 200 OK
{
  "id": 1,
  "username": "john_doe",
  "email": "john@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "role": "admin",
  "description": "User bio"
}
```

### Update User
```
PUT /users/{id}/
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Doe",
  "description": "Updated bio"
}

Response: 200 OK
```

---

## 🔄 Project Contributors Endpoints

### Assign User to Project
```
POST /assign-user/
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "user_id": 1,
  "project_id": 1,
  "role": "project_engineer"
}

Response: 201 Created
```

### Remove User from Project
```
POST /remove-user/
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "user_id": 1,
  "project_id": 1
}

Response: 204 No Content
```

### Update User Role
```
PUT /update-user-role/{user_id}/
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "project_id": 1,
  "role": "project_manager"
}

Response: 200 OK
```

---

## 📋 Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Successful request |
| 201 | Created - Resource created successfully |
| 204 | No Content - Successful deletion/update with no response body |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

## 🚀 Frontend API Calls

All frontend API calls use the base URL: `http://localhost:8000/api/v1/`

**Example:**
```javascript
import API from "@/api/axios";

// Get all projects
const response = await API.get("projects/");

// Create new project
const newProject = await API.post("projects/", formData, {
  headers: { "Content-Type": "multipart/form-data" }
});

// Upload BIM file
const bimUpload = await API.post(`projects/${projectId}/bim/`, formData, {
  headers: { "Content-Type": "multipart/form-data" }
});
```

---

## 📖 Interactive Swagger Documentation

Visit: `http://localhost:8000/api/docs/`

- Try out endpoints directly in the browser
- See request/response examples
- View all parameters and required fields
- Test authentication flows

