from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('processing', '0009_progresselement_level'),
    ]

    operations = [
        migrations.AddField(
            model_name='alignmentpair',
            name='semantic_snapshot',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='alignmentpair',
            name='semantic_snapshot_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='progresselement',
            name='built_by',
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name='progresselement',
            name='level_elevation',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='progresselement',
            name='sam_built_ratio',
            field=models.FloatField(blank=True, null=True),
        ),
    ]
