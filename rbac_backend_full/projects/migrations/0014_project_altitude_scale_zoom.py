from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0013_project_slug"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="altitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="project",
            name="scale",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="project",
            name="zoom",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
