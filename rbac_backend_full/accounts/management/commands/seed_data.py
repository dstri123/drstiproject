from django.core.management.base import BaseCommand
from accounts.models import User, Organization
from projects.models import Project, ProjectUser, BIMData, PointCloudData
from datetime import datetime, timedelta


class Command(BaseCommand):
    help = "Seed database with dummy organizations, multiple admin users, and different roles"

    def handle(self, *args, **options):
        # Seed the super admin first (idempotent, no organization).
        superadmin, created = User.objects.get_or_create(
            username="superadmin",
            defaults={
                "email": "superadmin@drsti.com",
                "first_name": "Super",
                "last_name": "Admin",
                "role": "superadmin",
                "is_staff": True,
                "is_superuser": True,
            },
        )
        if created:
            superadmin.set_password("SuperAdmin@123")
            superadmin.save()
            self.stdout.write(
                self.style.SUCCESS(
                    "[OK] Super Admin: superadmin (superadmin@drsti.com) / SuperAdmin@123"
                )
            )
        else:
            self.stdout.write(
                self.style.WARNING("Super Admin already exists. Skipping...")
            )

        # Check if data already exists
        if Organization.objects.exists():
            self.stdout.write(self.style.WARNING("Database already seeded. Skipping..."))
            return

        # Comprehensive dummy data with multiple admins and roles
        organizations_data = [
            {
                "name": "Acme Corporation",
                "admins": [
                    {
                        "username": "acme_admin1",
                        "email": "admin1@acmecorp.com",
                        "password": "AcmeAdmin@123",
                        "first_name": "John",
                        "last_name": "Smith",
                    },
                    {
                        "username": "acme_admin2",
                        "email": "admin2@acmecorp.com",
                        "password": "AcmeAdmin@456",
                        "first_name": "Alice",
                        "last_name": "Johnson",
                    },
                    {
                        "username": "acme_admin3",
                        "email": "admin3@acmecorp.com",
                        "password": "AcmeAdmin@789",
                        "first_name": "Robert",
                        "last_name": "Miller",
                    },
                ],
                "members": [
                    {
                        "username": "acme_member1",
                        "email": "member1@acmecorp.com",
                        "password": "AcmeMember@123",
                        "first_name": "Emma",
                        "last_name": "Wilson",
                        "role": "member",
                    },
                    {
                        "username": "acme_pm1",
                        "email": "pm1@acmecorp.com",
                        "password": "AcmePM@123",
                        "first_name": "Tom",
                        "last_name": "Brown",
                        "role": "project_manager",
                    },
                ],
            },
            {
                "name": "Tech Innovators Inc",
                "admins": [
                    {
                        "username": "tech_admin1",
                        "email": "admin1@techinnovators.com",
                        "password": "TechAdmin@123",
                        "first_name": "Sarah",
                        "last_name": "Johnson",
                    },
                    {
                        "username": "tech_admin2",
                        "email": "admin2@techinnovators.com",
                        "password": "TechAdmin@456",
                        "first_name": "Michael",
                        "last_name": "Davis",
                    },
                ],
                "members": [
                    {
                        "username": "tech_member1",
                        "email": "member1@techinnovators.com",
                        "password": "TechMember@123",
                        "first_name": "Lisa",
                        "last_name": "Garcia",
                        "role": "member",
                    },
                    {
                        "username": "tech_engineer1",
                        "email": "engineer1@techinnovators.com",
                        "password": "TechEng@123",
                        "first_name": "James",
                        "last_name": "Martinez",
                        "role": "project_engineer",
                    },
                ],
            },
            {
                "name": "Global Solutions Ltd",
                "admins": [
                    {
                        "username": "global_admin1",
                        "email": "admin1@globalsolutions.com",
                        "password": "GlobalAdmin@123",
                        "first_name": "Michael",
                        "last_name": "Williams",
                    },
                    {
                        "username": "global_admin2",
                        "email": "admin2@globalsolutions.com",
                        "password": "GlobalAdmin@456",
                        "first_name": "Jennifer",
                        "last_name": "Taylor",
                    },
                ],
                "members": [
                    {
                        "username": "global_member1",
                        "email": "member1@globalsolutions.com",
                        "password": "GlobalMember@123",
                        "first_name": "Christopher",
                        "last_name": "Anderson",
                        "role": "member",
                    },
                    {
                        "username": "global_contributor1",
                        "email": "contributor1@globalsolutions.com",
                        "password": "GlobalContrib@123",
                        "first_name": "Patricia",
                        "last_name": "Thomas",
                        "role": "data_contributor",
                    },
                ],
            },
            {
                "name": "Future Tech Ventures",
                "admins": [
                    {
                        "username": "future_admin1",
                        "email": "admin1@futuretech.com",
                        "password": "FutureAdmin@123",
                        "first_name": "Emily",
                        "last_name": "Brown",
                    },
                    {
                        "username": "future_admin2",
                        "email": "admin2@futuretech.com",
                        "password": "FutureAdmin@456",
                        "first_name": "David",
                        "last_name": "Jackson",
                    },
                    {
                        "username": "future_admin3",
                        "email": "admin3@futuretech.com",
                        "password": "FutureAdmin@789",
                        "first_name": "Karen",
                        "last_name": "White",
                    },
                ],
                "members": [
                    {
                        "username": "future_member1",
                        "email": "member1@futuretech.com",
                        "password": "FutureMember@123",
                        "first_name": "Daniel",
                        "last_name": "Harris",
                        "role": "member",
                    },
                    {
                        "username": "future_pm1",
                        "email": "pm1@futuretech.com",
                        "password": "FuturePM@123",
                        "first_name": "Nancy",
                        "last_name": "Martin",
                        "role": "project_manager",
                    },
                    {
                        "username": "future_engineer1",
                        "email": "engineer1@futuretech.com",
                        "password": "FutureEng@123",
                        "first_name": "Paul",
                        "last_name": "Lee",
                        "role": "project_engineer",
                    },
                ],
            },
            {
                "name": "NextGen Systems",
                "admins": [
                    {
                        "username": "nextgen_admin1",
                        "email": "admin1@nextgensystems.com",
                        "password": "NextGen@123",
                        "first_name": "David",
                        "last_name": "Davis",
                    },
                    {
                        "username": "nextgen_admin2",
                        "email": "admin2@nextgensystems.com",
                        "password": "NextGen@456",
                        "first_name": "Linda",
                        "last_name": "Rodriguez",
                    },
                ],
                "members": [
                    {
                        "username": "nextgen_member1",
                        "email": "member1@nextgensystems.com",
                        "password": "NextGenMember@123",
                        "first_name": "Barbara",
                        "last_name": "Clark",
                        "role": "member",
                    },
                    {
                        "username": "nextgen_contributor1",
                        "email": "contributor1@nextgensystems.com",
                        "password": "NextGenContrib@123",
                        "first_name": "Steven",
                        "last_name": "Lewis",
                        "role": "data_contributor",
                    },
                    {
                        "username": "nextgen_pm1",
                        "email": "pm1@nextgensystems.com",
                        "password": "NextGenPM@123",
                        "first_name": "Jessica",
                        "last_name": "Walker",
                        "role": "project_manager",
                    },
                ],
            },
        ]

        # Create organizations and users
        org_count = 0
        user_count = 0

        for org_data in organizations_data:
            try:
                # Create organization
                org = Organization.objects.create(name=org_data["name"])
                org_count += 1

                self.stdout.write(
                    self.style.SUCCESS(f"[OK] Organization: {org.name}")
                )

                # Create admin users
                for admin_data in org_data.get("admins", []):
                    admin_user = User.objects.create_user(
                        username=admin_data["username"],
                        email=admin_data["email"],
                        password=admin_data["password"],
                        first_name=admin_data["first_name"],
                        last_name=admin_data["last_name"],
                        role="admin",
                        organization=org,
                    )
                    user_count += 1
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  +-- Admin: {admin_user.username} ({admin_user.email})"
                        )
                    )

                # Create other role users
                for member_data in org_data.get("members", []):
                    member_user = User.objects.create_user(
                        username=member_data["username"],
                        email=member_data["email"],
                        password=member_data["password"],
                        first_name=member_data["first_name"],
                        last_name=member_data["last_name"],
                        role=member_data.get("role", "member"),
                        organization=org,
                    )
                    user_count += 1
                    role_display = member_data.get("role", "member").replace("_", " ").title()
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  +-- {role_display}: {member_user.username} ({member_user.email})"
                        )
                    )

            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f"[ERROR] Failed to create {org_data['name']}: {str(e)}")
                )

        # Create dummy projects with users and data
        project_count = 0
        try:
            org_list = Organization.objects.all()
            projects_data = [
                {
                    "org_idx": 0,
                    "name": "ABC Building Renovation",
                    "description": "Complete renovation and modernization of the ABC office building including structural analysis and BIM modeling",
                    "image": "projects/building_dark.jpg",
                    "start": datetime.now() - timedelta(days=30),
                    "end": datetime.now() + timedelta(days=60),
                    "has_bim": True,
                    "has_cloud": False,
                    "has_images": False,
                    "users": ["acme_admin1", "acme_pm1"]
                },
                {
                    "org_idx": 0,
                    "name": "SSDF Building Survey",
                    "description": "Comprehensive point cloud survey and 3D scanning of the SSDF facility for asset documentation",
                    "image": "projects/building_pink.jpg",
                    "start": datetime.now() - timedelta(days=45),
                    "end": datetime.now() + timedelta(days=45),
                    "has_bim": False,
                    "has_cloud": True,
                    "has_images": True,
                    "users": ["acme_admin1", "acme_member1"]
                },
                {
                    "org_idx": 1,
                    "name": "Tech Park Infrastructure",
                    "description": "Infrastructure planning and documentation for the new tech park development with full BIM and point cloud data",
                    "image": "projects/building_orange.jpg",
                    "start": datetime.now() - timedelta(days=60),
                    "end": datetime.now() + timedelta(days=90),
                    "has_bim": True,
                    "has_cloud": True,
                    "has_images": True,
                    "users": ["tech_admin1", "tech_engineer1"]
                },
                {
                    "org_idx": 1,
                    "name": "Facility Assessment",
                    "description": "Quick facility assessment with photographic documentation only",
                    "image": "projects/building_dark.jpg",
                    "start": datetime.now() - timedelta(days=15),
                    "end": datetime.now() + timedelta(days=30),
                    "has_bim": False,
                    "has_cloud": False,
                    "has_images": False,
                    "users": ["tech_admin1", "tech_member1"]
                },
                {
                    "org_idx": 2,
                    "name": "Global Headquarters Expansion",
                    "description": "Major expansion project of global headquarters with complete documentation",
                    "image": "projects/building_pink.jpg",
                    "start": datetime.now() - timedelta(days=90),
                    "end": datetime.now() + timedelta(days=120),
                    "has_bim": True,
                    "has_cloud": True,
                    "has_images": True,
                    "users": ["global_admin1", "global_contributor1"]
                },
                {
                    "org_idx": 3,
                    "name": "Future Tech Lab",
                    "description": "State-of-the-art laboratory with BIM and point cloud documentation",
                    "image": "projects/building_orange.jpg",
                    "start": datetime.now() - timedelta(days=20),
                    "end": datetime.now() + timedelta(days=80),
                    "has_bim": True,
                    "has_cloud": True,
                    "has_images": False,
                    "users": ["future_admin1", "future_pm1", "future_engineer1"]
                },
                {
                    "org_idx": 4,
                    "name": "NextGen Operations Center",
                    "description": "Operations center with comprehensive BIM data for facility management",
                    "image": "projects/building_dark.jpg",
                    "start": datetime.now() - timedelta(days=50),
                    "end": datetime.now() + timedelta(days=100),
                    "has_bim": True,
                    "has_cloud": False,
                    "has_images": True,
                    "users": ["nextgen_admin1", "nextgen_contributor1"]
                },
            ]

            for proj_data in projects_data:
                try:
                    org = org_list[proj_data["org_idx"]]

                    project = Project.objects.create(
                        project_name=proj_data["name"],
                        description=proj_data["description"],
                        image=proj_data.get("image", ""),
                        start=proj_data["start"].date(),
                        end=proj_data["end"].date(),
                        slug=proj_data["name"].lower().replace(" ", "-")
                    )
                    project_count += 1

                    # Assign users to project
                    for username in proj_data["users"]:
                        user = User.objects.get(username=username)
                        ProjectUser.objects.get_or_create(project=project, user=user)

                    # Create dummy data based on has_* flags
                    if proj_data["has_bim"]:
                        BIMData.objects.create(
                            project=project,
                            description=f"{proj_data['name']} BIM Data",
                            file="",
                            date=proj_data["start"].date(),
                            is_latest=True
                        )

                    if proj_data["has_cloud"]:
                        PointCloudData.objects.create(
                            project=project,
                            description=f"{proj_data['name']} Point Cloud Data",
                            file="",
                            date=proj_data["start"].date(),
                            is_latest=True
                        )

                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  +-- Project: {project.project_name} ({', '.join(proj_data['users'])})"
                        )
                    )

                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(f"[ERROR] Failed to create project {proj_data['name']}: {str(e)}")
                    )

            self.stdout.write(
                self.style.SUCCESS(
                    f"\n[OK] Created {project_count} projects with dummy data"
                )
            )

        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f"[ERROR] Failed to seed projects: {str(e)}")
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"\n[SUCCESS] Successfully seeded {org_count} organizations with {user_count} total users!"
            )
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"\nSummary:\n"
                f"   * 5 Organizations\n"
                f"   * 12 Admin Users (2-3 per organization)\n"
                f"   * 13 Users with different roles:\n"
                f"     - Members\n"
                f"     - Project Managers\n"
                f"     - Project Engineers\n"
                f"     - Data Contributors\n"
            )
        )
