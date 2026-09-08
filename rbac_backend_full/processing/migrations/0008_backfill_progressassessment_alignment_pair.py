from django.db import migrations


def backfill_alignment_pair(apps, schema_editor):
    ProgressAssessment = apps.get_model('processing', 'ProgressAssessment')
    AlignmentPair = apps.get_model('processing', 'AlignmentPair')

    pairs_by_combo = {
        (p.bim_id, p.pointcloud_id): p.id
        for p in AlignmentPair.objects.all()
    }
    for assessment in ProgressAssessment.objects.filter(alignment_pair__isnull=True):
        pair_id = pairs_by_combo.get((assessment.bim_id, assessment.pointcloud_id))
        if pair_id:
            assessment.alignment_pair_id = pair_id
            assessment.save(update_fields=['alignment_pair'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('processing', '0007_progressassessment_alignment_pair'),
    ]

    operations = [
        migrations.RunPython(backfill_alignment_pair, noop_reverse),
    ]
