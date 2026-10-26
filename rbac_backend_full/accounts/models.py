from django.contrib.auth.models import AbstractUser
from django.db import models


class Organization(models.Model):
    name = models.CharField(max_length=255)

    def __str__(self):
        return self.name


class User(AbstractUser):
    ROLE_CHOICES = [
        ("superadmin", "Super Admin"),
        ("admin", "Admin"),
        ("member", "Member"),
        ("project_manager", "Project Manager"),
        ("project_engineer", "Project Engineer"),
        ("data_contributor", "Data Contributor"),
    ]

    role = models.CharField(max_length=30, choices=ROLE_CHOICES)
    sub_role = models.CharField(max_length=50, null=True, blank=True)
    bio = models.TextField(blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    avatar = models.ImageField(upload_to="profile_avatars/", blank=True, null=True)

    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )

    # The admin (or superadmin) who created this account. Used to group
    # sub-role users under their admin, e.g. in the activity log.
    created_by = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_users",
    )

    def __str__(self):
        return f"{self.username} ({self.role})"