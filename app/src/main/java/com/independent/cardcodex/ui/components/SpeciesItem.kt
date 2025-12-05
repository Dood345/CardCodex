package com.independent.cardcodex.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.decode.SvgDecoder
import coil.request.ImageRequest
import com.independent.cardcodex.R
import com.independent.cardcodex.feature_pokedex.CodexEntry

@Composable
fun CodexItem(
    entry: CodexEntry, 
    onClick: () -> Unit,
    isOwned: Boolean = true
) {
    val typeColor = getTypeColor(entry.type)
    
    // Determine Scale Type based on content
    val scaleType = when {
        entry.isSpecies -> ContentScale.Fit
        entry.iconUrl.endsWith(".svg", ignoreCase = true) -> ContentScale.Fit
        else -> ContentScale.Crop
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isOwned) MaterialTheme.colorScheme.surface else Color.LightGray
        )
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            if (entry.iconUrl.startsWith("placeholder:")) {
                 val iconRes = when (entry.iconUrl) {
                     "placeholder:trainer" -> R.drawable.ic_trainer_placeholder
                     "placeholder:energy" -> R.drawable.ic_energy_placeholder
                     else -> R.drawable.ic_trainer_placeholder // Default fallback
                 }
                 Image(
                     painter = painterResource(id = iconRes),
                     contentDescription = entry.name,
                     modifier = Modifier.size(64.dp),
                     colorFilter = ColorFilter.tint(Color.DarkGray)
                 )
            } else {
                AsyncImage(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(entry.iconUrl)
                        .decoderFactory(SvgDecoder.Factory())
                        .build(),
                    contentDescription = entry.name,
                    modifier = Modifier.size(if (scaleType == ContentScale.Crop) 120.dp else 80.dp),
                    contentScale = scaleType,
                    colorFilter = if (!isOwned && scaleType == ContentScale.Fit) ColorFilter.tint(Color.Black, BlendMode.SrcIn) else null,
                    error = remember { null }
                )
            }
            
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(if (isOwned) typeColor.copy(alpha = 0.8f) else Color.DarkGray)
                    .padding(4.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = if (isOwned) entry.name else if (entry.isSpecies) "???" else if (entry.type == "Trainer" || entry.type == "Energy") "???" else entry.name,
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1
                )
            }
        }
    }
}

fun getTypeColor(type: String?): Color {
    return when (type?.lowercase()) {
        "fire" -> Color(0xFFEE8130)
        "water" -> Color(0xFF6390F0)
        "grass" -> Color(0xFF7AC74C)
        "electric" -> Color(0xFFF7D02C)
        "psychic" -> Color(0xFFF95587)
        "ice" -> Color(0xFF96D9D6)
        "dragon" -> Color(0xFF6F35FC)
        "dark", "darkness" -> Color(0xFF705746)
        "fairy" -> Color(0xFFD685AD)
        "normal", "colorless" -> Color(0xFFA8A77A)
        "fighting" -> Color(0xFFC22E28)
        "flying" -> Color(0xFFA98FF3)
        "poison" -> Color(0xFFA33EA1)
        "ground" -> Color(0xFFE2BF65)
        "rock" -> Color(0xFFB6A136)
        "bug" -> Color(0xFFA6B91A)
        "ghost" -> Color(0xFF735797)
        "steel", "metal" -> Color(0xFFB7B7CE)
        "electric", "lightning" -> Color(0xFFF7D02C)
        else -> Color.Gray
    }
}
