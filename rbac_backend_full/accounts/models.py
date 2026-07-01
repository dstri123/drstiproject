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

    def __str__(self):
        return f"{self.username} ({self.role})"