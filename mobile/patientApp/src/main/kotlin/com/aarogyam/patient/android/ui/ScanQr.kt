package com.aarogyam.patient.android.ui

import android.widget.Toast
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.aarogyam.patient.android.R
import com.aarogyam.patient.clinics.ClinicsStateHolder
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant

/**
 * "Scan QR": Google's code scanner screen (no camera permission needed). What it reads goes to the
 * same handling as typing the code; a QR that isn't a clinic's is ignored. The scanned text is
 * never logged.
 */
@Composable
fun ScanQrButton(
    holder: ClinicsStateHolder,
    enabled: Boolean,
) {
    val context = LocalContext.current
    val notOurs = stringResource(R.string.scan_qr_not_ours)
    val failed = stringResource(R.string.scan_qr_failed)
    SkButton(
        stringResource(R.string.scan_qr),
        {
            val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
            GmsBarcodeScanning
                .getClient(context, options)
                .startScan()
                .addOnSuccessListener { barcode ->
                    val ours = barcode.rawValue?.let(holder::onScanned) == true
                    if (!ours) Toast.makeText(context, notOurs, Toast.LENGTH_LONG).show()
                }.addOnFailureListener { error ->
                    // A closed scanner is a cancel, not an error.
                    if (error.message?.contains("cancel", ignoreCase = true) != true) {
                        Toast.makeText(context, failed, Toast.LENGTH_LONG).show()
                    }
                }
        },
        Modifier.fillMaxWidth(),
        variant = SkButtonVariant.Secondary,
        enabled = enabled,
    )
}
