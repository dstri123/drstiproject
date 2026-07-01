from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0010_bimdata_is_latest_pointclouddata_is_latest_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="bimdata",
            name="transform",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="pointclouddata",
            name="transform",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
