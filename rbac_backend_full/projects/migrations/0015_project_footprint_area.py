from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0014_project_altitude_scale_zoom"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="footprint_area",
            field=models.FloatField(blank=True, null=True),
        ),
    ]
