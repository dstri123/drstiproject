from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0008_pointclouddata_bimdata'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectImage',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('image', models.ImageField(upload_to='project_images/')),
                ('original_name', models.CharField(blank=True, max_length=255)),
                ('date', models.DateField(blank=True, null=True)),
                ('uploaded_at', models.DateTimeField(auto_now_add=True)),
                ('project', models.ForeignKey(on_delete=models.CASCADE, to='projects.project')),
            ],
        ),
    ]
