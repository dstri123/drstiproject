from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('projects', '0011_add_transform_fields'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ProcessingJob',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('job_type', models.CharField(choices=[
                    ('bim_parse', 'BIM Metadata Extraction'),
                    ('bim_validate', 'BIM File Validation'),
                    ('pc_subsample', 'Point Cloud Subsampling'),
                    ('pc_colorize', 'Point Cloud Colorization'),
                    ('ifc_convert', 'IFC Format Conversion'),
                    ('bounds_compute', 'Bounds Computation'),
                    ('thumbnail', 'Thumbnail Generation'),
                ], max_length=30)),
                ('status', models.CharField(choices=[
                    ('queued', 'Queued'), ('running', 'Running'),
                    ('completed', 'Completed'), ('failed', 'Failed'), ('cancelled', 'Cancelled'),
                ], default='queued', max_length=20)),
                ('progress', models.FloatField(default=0.0)),
                ('stage_label', models.CharField(blank=True, max_length=120)),
                ('error_message', models.TextField(blank=True)),
                ('result', models.JSONField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('bim_data', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='jobs', to='projects.bimdata')),
                ('point_data', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='jobs', to='projects.pointclouddata')),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='ModelBounds',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('xmin', models.FloatField()), ('xmax', models.FloatField()),
                ('ymin', models.FloatField()), ('ymax', models.FloatField()),
                ('zmin', models.FloatField()), ('zmax', models.FloatField()),
                ('center_x', models.FloatField(default=0)),
                ('center_y', models.FloatField(default=0)),
                ('center_z', models.FloatField(default=0)),
                ('span', models.FloatField(default=0)),
                ('point_count', models.BigIntegerField(blank=True, null=True)),
                ('triangle_count', models.BigIntegerField(blank=True, null=True)),
                ('computed_at', models.DateTimeField(auto_now=True)),
                ('bim_data', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='bounds', to='projects.bimdata')),
                ('point_data', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='bounds', to='projects.pointclouddata')),
            ],
            options={'verbose_name_plural': 'Model bounds'},
        ),
        migrations.CreateModel(
            name='ElementMetadata',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('step_id', models.CharField(max_length=40)),
                ('global_id', models.CharField(blank=True, max_length=64)),
                ('ifc_type', models.CharField(max_length=80)),
                ('name', models.CharField(blank=True, max_length=255)),
                ('category', models.CharField(choices=[
                    ('structure', 'Structure'), ('fills', 'Doors & Windows'),
                    ('other', 'Other'), ('space', 'Space'),
                ], default='other', max_length=20)),
                ('bounds', models.JSONField(blank=True, null=True)),
                ('convertible', models.BooleanField(default=True)),
                ('fds_role', models.CharField(blank=True, max_length=40)),
                ('bim_data', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='elements', to='projects.bimdata')),
            ],
            options={'ordering': ['ifc_type', 'name'], 'unique_together': {('bim_data', 'step_id')}},
        ),
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(choices=[
                    ('upload', 'File Uploaded'), ('delete', 'File Deleted'),
                    ('transform_save', 'Transform Saved'), ('visibility', 'Visibility Changed'),
                    ('convert', 'File Converted'), ('validate', 'File Validated'),
                    ('export', 'Export Downloaded'), ('process_start', 'Processing Started'),
                    ('process_done', 'Processing Completed'), ('process_fail', 'Processing Failed'),
                ], max_length=30)),
                ('description', models.CharField(max_length=500)),
                ('metadata', models.JSONField(blank=True, null=True)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('timestamp', models.DateTimeField(auto_now_add=True)),
                ('bim_data', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='projects.bimdata')),
                ('point_data', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='projects.pointclouddata')),
                ('user', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-timestamp']},
        ),
        migrations.CreateModel(
            name='DiagnosticReport',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('level', models.CharField(choices=[('info', 'Info'), ('warning', 'Warning'), ('error', 'Error')], max_length=10)),
                ('title', models.CharField(max_length=200)),
                ('detail', models.TextField(blank=True)),
                ('check_name', models.CharField(blank=True, max_length=80)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('bim_data', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='diagnostics', to='projects.bimdata')),
                ('point_data', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='diagnostics', to='projects.pointclouddata')),
            ],
            options={'ordering': ['level', 'title']},
        ),
    ]
